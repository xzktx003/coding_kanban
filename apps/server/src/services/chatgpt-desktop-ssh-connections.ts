import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstatSync, realpathSync, mkdirSync, writeFileSync, constants, openSync,
  closeSync, fstatSync, readSync, fsyncSync, renameSync, unlinkSync, type Stats,
} from "node:fs";
import { isAbsolute, resolve, join, posix } from "node:path";
import { once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { buildSshArgs, assertValidSshTarget } from "./ssh-command.js";
import type { ChatGptSshAliasDiscovery } from "./chatgpt-desktop-ssh-aliases.js";

const MAX_FRAME = 2 * 1024 * 1024,
  MAX_QUEUE = 8 * 1024 * 1024,
  MAX_PENDING = 64,
  MAX_CONNECTIONS = 8;
const READ_METHODS = new Set([
  "thread/list",
  "thread/read",
  "thread/turns/list",
  "account/read",
  "model/list",
  "config/read",
  "configRequirements/read",
]);
// The remote project picker needs directory metadata and names. File contents,
// watches, and other filesystem mutations stay unsupported.
const FILESYSTEM_READ_METHODS = new Set(["fs/getMetadata", "fs/readDirectory"]);
// The original project dialog has an explicit confirmation before asking the
// selected remote host to create a missing project directory.
const FILESYSTEM_DIRECTORY_CREATE_METHODS = new Set(["fs/createDirectory"]);
const APPROVAL_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);
const BASIC_APPROVAL_DECISIONS = new Set([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
const MAX_PENDING_SERVER_REQUESTS = 64,
  MAX_APPROVAL_DECISIONS_BYTES = 64 * 1024,
  MAX_PENDING_APPROVAL_BYTES = 256 * 1024;
// Writes are limited to explicit native thread creation/resume/send operations
// and bounded responses to tracked, exact-scope native approval requests.
const THREAD_ACTION_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "turn/start",
]);
// Original SDK post-init only needs a tokenless status read, never credential refresh.
function isTokenlessAuthStatus(params: unknown): boolean {
  if (!params || typeof params !== "object" || Array.isArray(params)) return false;
  const value = params as Record<string, unknown>;
  return Object.keys(value).length === 2 &&
    Object.hasOwn(value, "includeToken") && Object.hasOwn(value, "refreshToken") &&
    value.includeToken === false && value.refreshToken === false;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validRpcId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}
function rpcIdKey(value: string | number): string {
  return `${typeof value}:${value}`;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isCanonicalPosixPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(value) && posix.isAbsolute(value) &&
    posix.normalize(value) === value;
}
function isValidFilesystemReadRequest(frame: Record<string, unknown>): boolean {
  if (!Object.hasOwn(frame, "id") || !validRpcId(frame.id) ||
      !isPlainObject(frame.params) || Object.keys(frame.params).length !== 1 ||
      !Object.hasOwn(frame.params, "path")) return false;
  return isCanonicalPosixPath(frame.params.path);
}
function isValidFilesystemDirectoryCreateRequest(frame: Record<string, unknown>): boolean {
  if (!Object.hasOwn(frame, "id") || !validRpcId(frame.id) ||
      !isPlainObject(frame.params) || !hasOnlyKeys(frame.params, ["path", "recursive"]) ||
      !Object.hasOwn(frame.params, "path") ||
      !isCanonicalPosixPath(frame.params.path) || frame.params.path === "/") return false;
  return !Object.hasOwn(frame.params, "recursive") || frame.params.recursive === null ||
    typeof frame.params.recursive === "boolean";
}
interface PendingServerApproval {
  method: string;
  availableDecisions?: unknown[];
  requestedPermissions?: Record<string, unknown>;
  metadataBytes: number;
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isPermissionNetwork(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "enabled") &&
    (value.enabled === null || typeof value.enabled === "boolean");
}
function isSpecialFileSystemPath(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "root":
    case "minimal":
    case "tmpdir":
    case "slash_tmp":
      return Object.keys(value).length === 1;
    case "project_roots":
      return Object.keys(value).length === 2 &&
        (value.subpath === null || typeof value.subpath === "string");
    case "unknown":
      return Object.keys(value).length === 3 && typeof value.path === "string" &&
        (value.subpath === null || typeof value.subpath === "string");
    default:
      return false;
  }
}
function isFileSystemPath(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "path":
      return Object.keys(value).length === 2 && typeof value.path === "string";
    case "glob_pattern":
      return Object.keys(value).length === 2 && typeof value.pattern === "string";
    case "special":
      return Object.keys(value).length === 2 && isSpecialFileSystemPath(value.value);
    default:
      return false;
  }
}
function isPermissionFileSystem(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["read", "write", "globScanMaxDepth", "entries"]) ||
      !Object.hasOwn(value, "read") || !Object.hasOwn(value, "write")) return false;
  const validLegacyPaths = (paths: unknown) => paths === null ||
    (Array.isArray(paths) && paths.every((path) => typeof path === "string"));
  if (!validLegacyPaths(value.read) || !validLegacyPaths(value.write)) return false;
  if (Object.hasOwn(value, "globScanMaxDepth") &&
      (typeof value.globScanMaxDepth !== "number" || !Number.isSafeInteger(value.globScanMaxDepth) || value.globScanMaxDepth < 0))
    return false;
  if (Object.hasOwn(value, "entries") &&
      (!Array.isArray(value.entries) || value.entries.some((entry) =>
        !isPlainObject(entry) || Object.keys(entry).length !== 2 ||
        !Object.hasOwn(entry, "path") || !isFileSystemPath(entry.path) ||
        !["read", "write", "deny"].includes(String(entry.access)))))
    return false;
  return true;
}
function isRequestedPermissionProfile(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length === 2 &&
    Object.hasOwn(value, "network") && Object.hasOwn(value, "fileSystem") &&
    (value.network === null || isPermissionNetwork(value.network)) &&
    (value.fileSystem === null || isPermissionFileSystem(value.fileSystem));
}
function isGrantedPermissionProfile(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && hasOnlyKeys(value, ["network", "fileSystem"]) &&
    (!Object.hasOwn(value, "network") || isPermissionNetwork(value.network)) &&
    (!Object.hasOwn(value, "fileSystem") || isPermissionFileSystem(value.fileSystem));
}
function isOrderedPermissionEntrySubset(
  granted: unknown[],
  requested: unknown[],
): boolean {
  let index = 0;
  for (const entry of granted) {
    while (index < requested.length && !isDeepStrictEqual(requested[index], entry)) index++;
    if (index >= requested.length) return false;
    index++;
  }
  return true;
}
function isPermissionFileSystemGrant(
  granted: Record<string, unknown>,
  requested: unknown,
): boolean {
  if (!isPermissionFileSystem(requested)) return false;
  if (isDeepStrictEqual(granted, requested)) return true;
  // The fixed UI's detailed permission-policy path nulls legacy read/write
  // lists and filters entries without changing the surviving entry values.
  if (granted.read !== null || granted.write !== null ||
      !Array.isArray(granted.entries) || granted.entries.length === 0 ||
      !Array.isArray(requested.entries) ||
      Object.keys(granted).length !== Object.keys(requested).length ||
      !Object.keys(granted).every((key) => Object.hasOwn(requested, key)) ||
      !isOrderedPermissionEntrySubset(granted.entries, requested.entries))
    return false;
  return Object.keys(requested).every((key) =>
    key === "read" || key === "write" || key === "entries" ||
    isDeepStrictEqual(granted[key], requested[key]));
}
function isPermissionGrantResponse(
  value: Record<string, unknown>,
  requested: Record<string, unknown> | undefined,
): boolean {
  if (!requested || !hasOnlyKeys(value, ["permissions", "scope", "strictAutoReview"]) ||
      !Object.hasOwn(value, "permissions") || !Object.hasOwn(value, "scope") ||
      !isGrantedPermissionProfile(value.permissions)) return false;
  const permissions = value.permissions;
  const keys = Object.keys(permissions);
  if (keys.length === 0) {
    // The fixed original UI's deny path is exactly this turn-scoped empty grant.
    return Object.keys(value).length === 2 && value.scope === "turn";
  }
  if ((value.scope !== "turn" && value.scope !== "session") ||
      !Object.hasOwn(value, "strictAutoReview") ||
      typeof value.strictAutoReview !== "boolean") return false;
  // Only pass through permission objects exactly declared by the native request.
  // The original UI omits null top-level fields and applies one known filesystem
  // policy projection that only removes requested entries and legacy path lists.
  for (const key of keys) {
    const declared = requested[key];
    if (declared === null || declared === undefined) return false;
    if (key === "fileSystem") {
      if (!isPermissionFileSystemGrant(permissions.fileSystem as Record<string, unknown>, declared))
        return false;
    } else if (!isDeepStrictEqual(permissions[key], declared)) return false;
  }
  // The original UI can set strict review only when it grants requested network access.
  return value.strictAutoReview !== true ||
    (isPlainObject(permissions.network) && permissions.network.enabled === true);
}
function approvalResponseKey(
  frame: Record<string, unknown>,
  pending: Map<string, PendingServerApproval>,
): string | null {
  if (Object.keys(frame).length !== 2 || !Object.hasOwn(frame, "id") ||
      !Object.hasOwn(frame, "result") || !validRpcId(frame.id) ||
      !isPlainObject(frame.result))
    return null;
  const key = rpcIdKey(frame.id), request = pending.get(key);
  if (!request) return null;
  if (request.method === "item/permissions/requestApproval")
    return isPermissionGrantResponse(frame.result, request.requestedPermissions) ? key : null;
  if (Object.keys(frame.result).length !== 1 || !Object.hasOwn(frame.result, "decision"))
    return null;
  const decision = frame.result.decision;
  if (request.method === "item/commandExecution/requestApproval" &&
      request.availableDecisions !== undefined)
    return request.availableDecisions.some((value) => isDeepStrictEqual(value, decision))
      ? key
      : null;
  return APPROVAL_REQUEST_METHODS.has(request.method) &&
    typeof decision === "string" && BASIC_APPROVAL_DECISIONS.has(decision)
    ? key
    : null;
}
export interface SshConnectionScope {
  id: string;
  generation: string;
}
export interface SshCurrentScope extends SshConnectionScope {
  identity: string;
}
export type SshConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";
export interface SshConnectionMetadata {
  alias: string;
  state: SshConnectionState;
  connectionId?: string;
  reasonCode?: string;
}
export interface SshConnectionSocket {
  send(text: string): Promise<void>;
  close(code: number, reason: string): void;
}
export interface ChatGptSshConnections {
  probeVersion(
    alias: string,
    scope: SshConnectionScope,
  ): Promise<{ code: 0; stdout: string; stderr: string }>;
  discover(
    scope: SshConnectionScope,
  ): Promise<{ sshAliases: readonly string[] }>;
  save(
    aliases: readonly string[],
    scope: SshConnectionScope,
  ): Promise<{ connections: SshConnectionMetadata[] }>;
  refresh(
    scope: SshConnectionScope,
  ): Promise<{ connections: SshConnectionMetadata[] }>;
  connect(
    alias: string,
    scope: SshConnectionScope,
  ): Promise<SshConnectionMetadata & { connectionId: string }>;
  attach(
    connectionId: string,
    scope: SshConnectionScope,
    socket: SshConnectionSocket,
  ): Promise<{ write(text: string): void; close(): void }>;
  disconnect(
    alias: string,
    scope: SshConnectionScope,
  ): Promise<{ alias: string; state: "disconnected" }>;
  close(): void;
}
export interface ChatGptSshConnectionsOptions {
  configPath: string;
  runtimeRoot: string;
  sshBinary?: string;
  discovery: ChatGptSshAliasDiscovery;
  /** Full native/profile identity, from the same fixed profile reader, never HTTP. */
  readScope(): Promise<SshCurrentScope | null>;
}
const failure = (code: string) =>
  Object.assign(new Error("SSH connection unavailable"), { code });
function fixedPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isAbsolute(value) &&
    resolve(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
function safeFile(file: string, executable = false) {
  if (!fixedPath(file) || realpathSync(file) !== file)
    throw failure("SSH_CONFIG_UNSAFE");
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    (stat.uid !== process.getuid!() && stat.uid !== 0) ||
    (stat.mode & 0o022) !== 0 ||
    (executable && (stat.mode & 0o111) === 0)
  )
    throw failure("SSH_CONFIG_UNSAFE");
}
function aliasValue(alias: unknown): asserts alias is string {
  if (
    typeof alias !== "string" ||
    alias.length > 255 ||
    /[\x00-\x20\x7f*?!]/.test(alias)
  )
    throw failure("SSH_ALIAS_UNAVAILABLE");
  try {
    assertValidSshTarget({ host: alias });
  } catch {
    throw failure("SSH_ALIAS_UNAVAILABLE");
  }
}
/** Fixed dedicated stdio process. Never join a control master or run a remote kill. */
export function buildChatGptSshConnectionArgs(
  alias: string,
  configPath: string,
): string[] {
  aliasValue(alias);
  if (!fixedPath(configPath)) throw failure("SSH_CONFIG_UNSAFE");
  return [
    "-T",
    "-F",
    configPath,
    "-S",
    "none",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPersist=no",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "RequestTTY=no",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    ...buildSshArgs(
      { host: alias },
      {
        batchMode: true,
        clearAllForwardings: true,
        connectTimeoutSeconds: 10,
        remoteCommand: "exec codex app-server",
      },
    ),
  ];
}
interface Entry {
  alias: string;
  id: string;
  state: SshConnectionState;
  reasonCode?: string;
  directory: string;
  child?: ChildProcessWithoutNullStreams;
  socket?: SshConnectionSocket;
  claimed: boolean;
  closed: boolean;
  timer?: NodeJS.Timeout;
  initId?: string | number;
  initReplied: boolean;
  initialized: boolean;
  initializedQueued: boolean;
  queue: string[];
  queueBytes: number;
  pendingCount: number;
  writing: boolean;
  cancel: AbortController;
  pendingServerApprovals: Map<string, PendingServerApproval>;
  pendingApprovalBytes: number;
}
/** Constructor-only opt-in, read-only native RPC slice. No account/key contents are read. */
export function createChatGptSshConnections(
  options: ChatGptSshConnectionsOptions,
): ChatGptSshConnections {
  if (
    !options ||
    Object.keys(options).some(
      (k) =>
        ![
          "configPath",
          "runtimeRoot",
          "sshBinary",
          "discovery",
          "readScope",
        ].includes(k),
    ) ||
    !fixedPath(options.runtimeRoot) ||
    typeof options.readScope !== "function"
  )
    throw failure("SSH_CONFIG_UNSAFE");
  const binary = options.sshBinary ?? "/usr/bin/ssh";
  safeFile(options.configPath);
  safeFile(binary, true);
  const root = lstatSync(options.runtimeRoot);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    root.uid !== process.getuid!() ||
    (root.mode & 0o777) !== 0o700 ||
    realpathSync(options.runtimeRoot) !== options.runtimeRoot
  )
    throw failure("SSH_CONFIG_UNSAFE");
  const selectionPath = join(options.runtimeRoot, "selected-aliases.json");
  const maxSelectionBytes = 16 * 1024;
  let selectionLoaded = false, selectionFailed = false,
    selectionScope: string | undefined, selectionStamp: string | null = null;
  const stamp = (stat: Stats) => JSON.stringify([
    stat.dev, stat.ino, stat.uid, stat.mode, stat.nlink, stat.size,
    stat.mtimeMs, stat.ctimeMs,
  ]);
  function selectionRoot() {
    const now = lstatSync(options.runtimeRoot);
    if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== root.dev ||
        now.ino !== root.ino || now.uid !== root.uid || (now.mode & 0o7777) !== 0o700 ||
        realpathSync(options.runtimeRoot) !== options.runtimeRoot)
      throw failure("SSH_SELECTION_UNAVAILABLE");
  }
  function selectionFile(): Stats | null {
    let stat: Stats;
    try { stat = lstatSync(selectionPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== root.uid ||
        (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1 || stat.size > maxSelectionBytes)
      throw failure("SSH_SELECTION_UNAVAILABLE");
    return stat;
  }
  // No connection IDs, transport state, host details, credentials or auto-connect flags.
  function restoreSelection(scope: SshConnectionScope): string[] | undefined {
    if (selectionFailed) throw failure("SSH_SELECTION_UNAVAILABLE");
    selectionRoot();
    const bound = `${scope.id}/${scope.generation}`, stat = selectionFile();
    if (selectionLoaded) {
      if (selectionScope !== bound || (stat ? stamp(stat) : null) !== selectionStamp)
        throw failure("SSH_SELECTION_UNAVAILABLE");
      return undefined;
    }
    let selected: string[] = [];
    if (stat) {
      const fd = openSync(selectionPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (stamp(fstatSync(fd)) !== stamp(stat)) throw failure("SSH_SELECTION_UNAVAILABLE");
        const buffer = Buffer.alloc(maxSelectionBytes + 1);
        let size = 0, count: number;
        while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, size)) > 0) size += count;
        if (size > maxSelectionBytes || stamp(fstatSync(fd)) !== stamp(stat))
          throw failure("SSH_SELECTION_UNAVAILABLE");
        const value: unknown = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(buffer.subarray(0, size)));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("SSH_SELECTION_UNAVAILABLE");
        const saved = value as Record<string, unknown>;
        if (Object.keys(saved).length !== 4 || saved.version !== 1 ||
            saved.profileId !== scope.id || saved.generation !== scope.generation ||
            !Array.isArray(saved.aliases) || saved.aliases.length > 32 ||
            new Set(saved.aliases).size !== saved.aliases.length)
          throw failure("SSH_SELECTION_UNAVAILABLE");
        for (const alias of saved.aliases) aliasValue(alias);
        selected = [...saved.aliases];
      } finally { closeSync(fd); }
      selectionRoot();
      const after = selectionFile();
      if (!after || stamp(after) !== stamp(stat)) throw failure("SSH_SELECTION_UNAVAILABLE");
    }
    selectionLoaded = true;
    selectionScope = bound;
    selectionStamp = stat ? stamp(stat) : null;
    return selected;
  }
  function persistSelection(selected: readonly string[], scope: SshConnectionScope) {
    const temporary = join(options.runtimeRoot, `.selected-aliases-${randomUUID()}.tmp`);
    let fd: number | undefined, created = false;
    try {
      restoreSelection(scope);
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      writeFileSync(fd, JSON.stringify({version: 1, profileId: scope.id, generation: scope.generation, aliases: selected}) + "\n");
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      restoreSelection(scope);
      renameSync(temporary, selectionPath);
      created = false;
      const parentFd = openSync(options.runtimeRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(parentFd); } finally { closeSync(parentFd); }
      selectionRoot();
      const stat = selectionFile();
      if (!stat) throw failure("SSH_SELECTION_UNAVAILABLE");
      selectionStamp = stamp(stat);
    } catch {
      selectionFailed = true;
      throw failure("SSH_SELECTION_UNAVAILABLE");
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (created) { try { unlinkSync(temporary); } catch {} }
    }
  }
  const probes = new Map<string, (code: string) => void>();
  const entries = new Map<string, Entry>(),
    byAlias = new Map<string, Entry>();
  let aliases: string[] = [],
    identity: string | undefined,
    closed = false,
    attempts = 0;
  const metadata = (alias: string): SshConnectionMetadata => {
    const e = byAlias.get(alias);
    return e
      ? {
          alias,
          state: e.state,
          connectionId: e.id,
          ...(e.reasonCode ? { reasonCode: e.reasonCode } : {}),
        }
      : { alias, state: "disconnected" };
  };
  const log = (e: Entry, code: string) => {
    try {
      writeFileSync(
        join(e.directory, "first-cause.json"),
        JSON.stringify({ phase: "ssh-connection", code, at: Date.now() }) +
          "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      /* metadata logging must not affect transport */
    }
  };
  function retire(
    e: Entry,
    code: string,
    state: SshConnectionState = "failed",
  ) {
    if (e.closed) return;
    e.closed = true;
    e.cancel.abort();
    e.state = state;
    e.reasonCode = state === "failed" ? code : undefined;
    clearTimeout(e.timer);
    e.queue.length = 0;
    e.queueBytes = 0;
    e.pendingCount = 0;
    e.pendingServerApprovals.clear();
    e.pendingApprovalBytes = 0;
    log(e, code);
    try {
      e.socket?.close(1011, code);
    } catch {}
    // Retire only this manager-owned SSH child. Never search by PID, signal a
    // process group, infer task state, or resend a request after disconnect.
    e.child?.stdin.destroy();
    if (e.child && e.child.exitCode === null && e.child.signalCode === null)
      e.child.kill("SIGTERM");
  }
  async function current(scope: SshConnectionScope) {
    let value: SshCurrentScope | null;
    try {
      value = await options.readScope();
    } catch {
      value = null;
    }
    if (
      closed ||
      !value ||
      !UUID.test(scope.id) ||
      !UUID.test(scope.generation) ||
      value.id !== scope.id ||
      value.generation !== scope.generation ||
      !value.identity ||
      (identity !== undefined && value.identity !== identity)
    ) {
      for (const e of entries.values()) retire(e, "SSH_PROFILE_CHANGED");
      for (const cancel of probes.values()) cancel("SSH_PROFILE_CHANGED");
      throw failure("SSH_PROFILE_CHANGED");
    }
    identity ??= value.identity;
    try {
      const restored = restoreSelection(scope);
      if (restored !== undefined) aliases = restored;
    } catch {
      selectionFailed = true;
      for (const e of entries.values()) retire(e, "SSH_SELECTION_UNAVAILABLE");
      for (const cancel of probes.values()) cancel("SSH_SELECTION_UNAVAILABLE");
      throw failure("SSH_SELECTION_UNAVAILABLE");
    }
  }
  function allowed(alias: string) {
    aliasValue(alias);
    const found = options.discovery.discover();
    if (found.configState !== "ready" || !found.sshAliases.includes(alias))
      throw failure("SSH_ALIAS_UNAVAILABLE");
  }
  const list = () => ({ connections: aliases.map(metadata) });
  async function connect(alias: string, scope: SshConnectionScope) {
    await current(scope);
    allowed(alias);
    if (!aliases.includes(alias)) throw failure("SSH_ALIAS_NOT_SAVED");
    const prior = byAlias.get(alias);
    if (prior && !prior.closed) throw failure("SSH_CONNECTION_EXISTS");
    if (
      ++attempts > 64 ||
      probes.size +
        Array.from(entries.values()).filter((e) => !e.closed).length >=
        MAX_CONNECTIONS
    )
      throw failure("SSH_CONNECTION_LIMIT");
    const id = randomUUID(),
      directory = join(options.runtimeRoot, id);
    mkdirSync(directory, { mode: 0o700 });
    const e: Entry = {
      alias,
      id,
      directory,
      state: "connecting",
      claimed: false,
      closed: false,
      initReplied: false,
      initialized: false,
      initializedQueued: false,
      queue: [],
      queueBytes: 0,
      pendingCount: 0,
      writing: false,
      cancel: new AbortController(),
      pendingServerApprovals: new Map(),
      pendingApprovalBytes: 0,
    };
    entries.set(id, e);
    byAlias.set(alias, e);
    e.timer = setTimeout(() => retire(e, "SSH_CONNECT_TIMEOUT"), 30_000);
    e.timer.unref();
    return { ...metadata(alias), connectionId: id };
  }
  async function probeVersion(alias: string, scope: SshConnectionScope) {
    await current(scope);
    allowed(alias);
    if (!aliases.includes(alias)) throw failure("SSH_ALIAS_NOT_SAVED");
    if (
      probes.size +
        Array.from(entries.values()).filter((e) => !e.closed).length >=
        MAX_CONNECTIONS ||
      ++attempts > 64
    )
      throw failure("SSH_CONNECTION_LIMIT");
    safeFile(options.configPath);
    safeFile(binary, true);
    const id = randomUUID(),
      directory = join(options.runtimeRoot, id);
    mkdirSync(directory, { mode: 0o700 });
    // The only probe command is this literal. No RPC/HTTP value becomes a command.
    const args = buildChatGptSshConnectionArgs(alias, options.configPath);
    args[args.length - 1] = "codex --version";
    const child = spawn(binary, args, {
      shell: false,
      stdio: "pipe",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.SSH_AUTH_SOCK
          ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }
          : {}),
        SSH_ASKPASS_REQUIRE: "never",
      },
    });
    return await new Promise<{ code: 0; stdout: string; stderr: string }>(
      (resolve, reject) => {
        let settled = false,
          stdout = Buffer.alloc(0),
          stderr = Buffer.alloc(0);
        const timer = setTimeout(
          () => stop("SSH_VERSION_PROBE_TIMEOUT"),
          10_000,
        );
        timer.unref();
        function stop(code: string) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          probes.delete(id);
          child.stdin.destroy();
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGTERM");
          try {
            writeFileSync(
              join(directory, "first-cause.json"),
              JSON.stringify({ phase: "version-probe", code, at: Date.now() }) +
                "\n",
              { flag: "wx", mode: 0o600 },
            );
          } catch {}
          reject(failure(code));
        }
        probes.set(id, stop);
        child.on("error", () => stop("SSH_VERSION_PROBE_FAILED"));
        child.stdin.on("error", () => stop("SSH_VERSION_PROBE_FAILED"));
        child.stdin.end();
        child.stdout.on("data", (chunk: Buffer) => {
          if (settled) return;
          if (stdout.length + chunk.length > 4096)
            return stop("SSH_VERSION_PROBE_LIMIT");
          stdout = Buffer.concat([stdout, chunk]);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (settled) return;
          if (stderr.length + chunk.length > 4096)
            return stop("SSH_VERSION_PROBE_LIMIT");
          stderr = Buffer.concat([stderr, chunk]);
        });
        child.on("close", async (code, signal) => {
          if (settled) return;
          if (code !== 0 || signal !== null)
            return stop("SSH_VERSION_PROBE_FAILED");
          try {
            await current(scope);
            allowed(alias);
            if (!aliases.includes(alias)) throw failure("SSH_ALIAS_NOT_SAVED");
            if (settled) return;
            const decoder = new TextDecoder("utf-8", { fatal: true }),
              out = decoder.decode(stdout),
              err = decoder.decode(stderr);
            settled = true;
            clearTimeout(timer);
            probes.delete(id);
            resolve({ code: 0, stdout: out, stderr: err });
          } catch {
            stop("SSH_VERSION_PROBE_FAILED");
          }
        });
      },
    );
  }
  async function attach(
    connectionId: string,
    scope: SshConnectionScope,
    socket: SshConnectionSocket,
  ) {
    await current(scope);
    const found = entries.get(connectionId);
    if (!found || found.closed || found.claimed)
      throw failure("SSH_CONNECTION_UNAVAILABLE");
    const e: Entry = found;
    allowed(e.alias);
    safeFile(options.configPath);
    safeFile(binary, true);
    e.claimed = true;
    e.socket = socket;
    const child = spawn(
      binary,
      buildChatGptSshConnectionArgs(e.alias, options.configPath),
      {
        shell: false,
        stdio: "pipe",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...(process.env.SSH_AUTH_SOCK
            ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }
            : {}),
          SSH_ASKPASS_REQUIRE: "never",
        },
      },
    );
    e.child = child;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => retire(e, "SSH_CONNECT_TIMEOUT"), 10_000);
    e.timer.unref();
    child.on("error", () => retire(e, "SSH_PROCESS_FAILED"));
    child.on("exit", () => retire(e, "SSH_PROCESS_EXITED"));
    child.stdin.on("error", () => retire(e, "SSH_WRITE_FAILED"));
    child.stderr.resume(); // Drain, never forward authentication text, paths or config to HTTP.
    let pending = Buffer.alloc(0),
      reading = false;
    let output = Promise.resolve(),
      outputCount = 0,
      outputBytes = 0;
    function deliver(text: string) {
      const bytes = Buffer.byteLength(text);
      if (
        e.closed ||
        outputCount >= MAX_PENDING ||
        outputBytes + bytes > MAX_QUEUE
      ) {
        retire(e, "SSH_QUEUE_LIMIT");
        return Promise.reject(failure("SSH_QUEUE_LIMIT"));
      }
      outputCount++;
      outputBytes += bytes;
      const next = output.then(async () => {
        await current(scope);
        if (e.closed) throw failure("SSH_CONNECTION_UNAVAILABLE");
        await socket.send(text);
      });
      output = next.catch(() => {});
      return next.finally(() => {
        outputCount--;
        outputBytes -= bytes;
      });
    }
    async function readOutput() {
      if (reading || e.closed) return;
      reading = true;
      try {
        for (;;) {
          const newline = pending.indexOf(10);
          if (newline >= 0) {
            const raw = pending.subarray(0, newline);
            pending = pending.subarray(newline + 1);
            if (raw.length > MAX_FRAME) throw failure("SSH_FRAME_LIMIT");
            let frame: any;
            try {
              frame = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(raw),
              );
            } catch {
              throw failure("SSH_PROTOCOL_INVALID");
            }
            if (!frame || typeof frame !== "object" || Array.isArray(frame))
              throw failure("SSH_PROTOCOL_INVALID");
            if (
              typeof frame.method === "string" &&
              Object.hasOwn(frame, "id") &&
              APPROVAL_REQUEST_METHODS.has(frame.method)
            ) {
              if (
                !e.initReplied ||
                !validRpcId(frame.id) ||
                !isPlainObject(frame.params) ||
                typeof frame.params.threadId !== "string" ||
                !frame.params.threadId.length ||
                frame.params.threadId.length > 256 ||
                /[\x00-\x1f\x7f]/.test(frame.params.threadId) ||
                typeof frame.params.turnId !== "string" ||
                !frame.params.turnId.length ||
                frame.params.turnId.length > 256 ||
                /[\x00-\x1f\x7f]/.test(frame.params.turnId) ||
                typeof frame.params.itemId !== "string" ||
                !frame.params.itemId.length ||
                frame.params.itemId.length > 256 ||
                /[\x00-\x1f\x7f]/.test(frame.params.itemId) ||
                e.pendingServerApprovals.size >= MAX_PENDING_SERVER_REQUESTS
              )
                throw failure("SSH_PROTOCOL_INVALID");
              const key = rpcIdKey(frame.id);
              if (e.pendingServerApprovals.has(key))
                throw failure("SSH_PROTOCOL_INVALID");
              let availableDecisions: unknown[] | undefined,
                requestedPermissions: Record<string, unknown> | undefined,
                metadataBytes = 0;
              if (frame.method === "item/permissions/requestApproval") {
                if (
                  !isRequestedPermissionProfile(frame.params.permissions) ||
                  !(frame.params.environmentId === null ||
                    (typeof frame.params.environmentId === "string" &&
                     frame.params.environmentId.length <= 4096 &&
                     !/[\x00-\x1f\x7f]/.test(frame.params.environmentId))) ||
                  typeof frame.params.startedAtMs !== "number" ||
                  !Number.isSafeInteger(frame.params.startedAtMs) ||
                  frame.params.startedAtMs < 0 ||
                  typeof frame.params.cwd !== "string" ||
                  !frame.params.cwd.length || frame.params.cwd.length > 4096 ||
                  /[\x00-\x1f\x7f]/.test(frame.params.cwd) ||
                  !(frame.params.reason === null ||
                    (typeof frame.params.reason === "string" &&
                     frame.params.reason.length <= 4096 &&
                     !/[\x00-\x1f\x7f]/.test(frame.params.reason)))
                )
                  throw failure("SSH_PROTOCOL_INVALID");
                const encoded = JSON.stringify(frame.params.permissions);
                metadataBytes = Buffer.byteLength(encoded);
                if (
                  metadataBytes > MAX_APPROVAL_DECISIONS_BYTES ||
                  e.pendingApprovalBytes + metadataBytes > MAX_PENDING_APPROVAL_BYTES
                )
                  throw failure("SSH_QUEUE_LIMIT");
                requestedPermissions = JSON.parse(encoded);
              }
              if (
                frame.method === "item/commandExecution/requestApproval" &&
                frame.params.availableDecisions != null
              ) {
                if (!Array.isArray(frame.params.availableDecisions) ||
                    frame.params.availableDecisions.length === 0 ||
                    frame.params.availableDecisions.length > 64)
                  throw failure("SSH_PROTOCOL_INVALID");
                const encoded = JSON.stringify(frame.params.availableDecisions);
                metadataBytes = Buffer.byteLength(encoded);
                if (
                  metadataBytes > MAX_APPROVAL_DECISIONS_BYTES ||
                  e.pendingApprovalBytes + metadataBytes > MAX_PENDING_APPROVAL_BYTES
                )
                  throw failure("SSH_QUEUE_LIMIT");
                availableDecisions = JSON.parse(encoded);
              }
              e.pendingServerApprovals.set(key, {
                method: frame.method,
                ...(availableDecisions === undefined ? {} : { availableDecisions }),
                ...(requestedPermissions === undefined ? {} : { requestedPermissions }),
                metadataBytes,
              });
              e.pendingApprovalBytes += metadataBytes;
            }
            if (
              e.initId !== undefined &&
              !e.initReplied &&
              frame.id === e.initId &&
              !Object.hasOwn(frame, "method")
            ) {
              if (frame.error) {
                await deliver(raw.toString("utf8"));
                throw failure("SSH_INITIALIZE_FAILED");
              }
              const result = frame.result;
              if (
                !result ||
                ["userAgent", "codexHome", "platformFamily", "platformOs"].some(
                  (k) =>
                    typeof result[k] !== "string" ||
                    !result[k].length ||
                    result[k].length > 4096,
                )
              )
                throw failure("SSH_PROTOCOL_INVALID");
              e.initReplied = true;
            }
            await deliver(raw.toString("utf8"));
            if (!e.closed && e.initReplied && !e.initialized) {
              e.initialized = true;
              e.state = "connected";
              clearTimeout(e.timer);
            }
            continue;
          }
          if (pending.length > MAX_FRAME) throw failure("SSH_FRAME_LIMIT");
          const size = Math.min(65_536, child.stdout.readableLength);
          if (!size) break;
          const chunk = child.stdout.read(size) as Buffer | null;
          if (!chunk) break;
          pending = Buffer.concat([pending, chunk]);
        }
      } catch (error) {
        retire(e, (error as { code?: string }).code ?? "SSH_TRANSPORT_FAILED");
      } finally {
        reading = false;
        if (!e.closed && child.stdout.readableLength)
          queueMicrotask(() => void readOutput());
      }
    }
    child.stdout.on("readable", () => void readOutput());
    child.stdout.on("end", () => {
      if (pending.length) retire(e, "SSH_PROTOCOL_INVALID");
    });
    async function drain() {
      if (e.writing || e.closed) return;
      e.writing = true;
      try {
        while (e.queue.length && !e.closed) {
          const text = e.queue.shift()!;
          try {
            await current(scope);
            if (e.closed) break;
            const frame = JSON.parse(text);
            if (!child.stdin.write(text + "\n"))
              await once(child.stdin, "drain", { signal: e.cancel.signal });
            if (frame.method === "initialized" && !e.closed) {
              e.initialized = true;
              e.state = "connected";
              clearTimeout(e.timer);
            }
          } finally {
            e.pendingCount = Math.max(0, e.pendingCount - 1);
            e.queueBytes = Math.max(0, e.queueBytes - Buffer.byteLength(text));
          }
        }
      } catch (error) {
        retire(e, (error as { code?: string }).code ?? "SSH_WRITE_FAILED");
      } finally {
        e.writing = false;
      }
    }
    return {
      write(text: string) {
        if (e.closed) return;
        try {
          if (
            typeof text !== "string" ||
            /[\r\n]/.test(text) ||
            Buffer.byteLength(text) > MAX_FRAME
          )
            throw failure("SSH_FRAME_LIMIT");
          let frame: any;
          try {
            frame = JSON.parse(text);
          } catch {
            throw failure("SSH_PROTOCOL_INVALID");
          }
          if (!isPlainObject(frame))
            throw failure("SSH_PROTOCOL_INVALID");
          const method = frame.method;
          if (typeof method !== "string") {
            const key = approvalResponseKey(frame, e.pendingServerApprovals);
            const request = key === null ? undefined : e.pendingServerApprovals.get(key);
            if (!request) throw failure("SSH_METHOD_UNAVAILABLE");
            e.pendingServerApprovals.delete(key!);
            e.pendingApprovalBytes = Math.max(0, e.pendingApprovalBytes - request.metadataBytes);
          } else {
            if (
              THREAD_ACTION_METHODS.has(method) &&
              (!Object.hasOwn(frame, "id") ||
                !validRpcId(frame.id) ||
                !frame.params ||
                typeof frame.params !== "object" ||
                Array.isArray(frame.params))
            )
              throw failure("SSH_PROTOCOL_INVALID");
            if (method === "initialize") {
              if (
                e.initId !== undefined ||
                !validRpcId(frame.id)
              )
                throw failure("SSH_PROTOCOL_INVALID");
              e.initId = frame.id;
            } else if (method === "initialized") {
              if (
                !e.initReplied ||
                e.initializedQueued ||
                Object.hasOwn(frame, "id")
              )
                throw failure("SSH_PROTOCOL_INVALID");
            } else if (
              !e.initReplied ||
              !(READ_METHODS.has(method) ||
                FILESYSTEM_READ_METHODS.has(method) ||
                FILESYSTEM_DIRECTORY_CREATE_METHODS.has(method) ||
                THREAD_ACTION_METHODS.has(method) ||
                (method === "getAuthStatus" && isTokenlessAuthStatus(frame.params)))
            ) {
              // Actual advertised negative capability, not a fabricated successful RPC.
              if (Object.hasOwn(frame, "id"))
                void deliver(
                  JSON.stringify({
                    id: frame.id,
                    error: { code: -32601, message: "SSH_METHOD_UNAVAILABLE" },
                  }),
                ).catch(() => retire(e, "SSH_TRANSPORT_FAILED"));
              else throw failure("SSH_METHOD_UNAVAILABLE");
              return;
            } else if (FILESYSTEM_READ_METHODS.has(method) &&
                       !isValidFilesystemReadRequest(frame)) {
              if (!Object.hasOwn(frame, "id") || !validRpcId(frame.id))
                throw failure("SSH_PROTOCOL_INVALID");
              void deliver(
                JSON.stringify({
                  id: frame.id,
                  error: { code: -32602, message: "SSH_FILESYSTEM_REQUEST_INVALID" },
                }),
              ).catch(() => retire(e, "SSH_TRANSPORT_FAILED"));
              return;
            } else if (FILESYSTEM_DIRECTORY_CREATE_METHODS.has(method) &&
                       !isValidFilesystemDirectoryCreateRequest(frame)) {
              if (!Object.hasOwn(frame, "id") || !validRpcId(frame.id))
                throw failure("SSH_PROTOCOL_INVALID");
              void deliver(
                JSON.stringify({
                  id: frame.id,
                  error: { code: -32602, message: "SSH_FILESYSTEM_REQUEST_INVALID" },
                }),
              ).catch(() => retire(e, "SSH_TRANSPORT_FAILED"));
              return;
            }
          }
          if (
            e.pendingCount >= MAX_PENDING ||
            (e.queueBytes += Buffer.byteLength(text)) > MAX_QUEUE
          )
            throw failure("SSH_QUEUE_LIMIT");
          if (method === "initialized") e.initializedQueued = true;
          e.pendingCount++;
          e.queue.push(text);
          void drain();
        } catch (error) {
          retire(
            e,
            (error as { code?: string }).code ?? "SSH_PROTOCOL_INVALID",
          );
        }
      },
      close() {
        retire(e, "SSH_CLIENT_CLOSED", "disconnected");
      },
    };
  }
  return Object.freeze({
    async discover(scope: SshConnectionScope) {
      await current(scope);
      return { sshAliases: options.discovery.discover().sshAliases };
    },
    async save(selected: readonly string[], scope: SshConnectionScope) {
      await current(scope);
      if (
        !Array.isArray(selected) ||
        selected.length > 32 ||
        new Set(selected).size !== selected.length
      )
        throw failure("SSH_REQUEST_INVALID");
      for (const alias of selected) allowed(alias);
      persistSelection(selected, scope);
      aliases = [...selected];
      return list();
    },
    async refresh(scope: SshConnectionScope) {
      await current(scope);
      return list();
    },
    connect,
    probeVersion,
    attach,
    async disconnect(alias: string, scope: SshConnectionScope) {
      await current(scope);
      aliasValue(alias);
      const e = byAlias.get(alias);
      if (e) retire(e, "SSH_DISCONNECTED", "disconnected");
      return { alias, state: "disconnected" as const };
    },
    close() {
      closed = true;
      for (const cancel of probes.values()) cancel("SSH_MANAGER_CLOSED");
      for (const e of entries.values())
        retire(e, "SSH_MANAGER_CLOSED", "disconnected");
    },
  });
}
