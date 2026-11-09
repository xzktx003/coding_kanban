import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";

const MAX_PROFILE_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LIVE_PROCESS_STATE = /^[RSDTtWPKI]$/;
const PROFILE_KEYS = [
  "version",
  "id",
  "generation",
  "pid",
  "startTicks",
  "uid",
  "macAsarPath",
  "macAsarSha256",
  "linuxAsarPath",
  "linuxAsarSha256",
  "controlSocketPath",
].sort();

export interface ChatGptDesktopProfile {
  version: 1;
  id: string;
  generation: string;
  pid: number;
  startTicks: string;
  uid: number;
  macAsarPath: string;
  macAsarSha256: string;
  linuxAsarPath: string;
  linuxAsarSha256: string;
  controlSocketPath: string;
  /** Private optional native SSH endpoint; never serialized by public status. */
  serverSshSocketPath?: string;
}

type FailureCode =
  | "invalid_profile_path"
  | "unsafe_profile_directory"
  | "unsafe_profile_file"
  | "profile_changed"
  | "invalid_profile"
  | "unsafe_asset_path"
  | "unsafe_control_directory"
  | "unsafe_control_socket"
  | "unsafe_server_ssh_directory"
  | "unsafe_server_ssh_socket"
  | "process_identity_unavailable"
  | "profile_unavailable";

export type ChatGptDesktopProfileStatus =
  | { state: "unconfigured"; reasonCode: "not_configured" }
  | { state: "unavailable"; reasonCode: FailureCode }
  | {
      state: "ready";
      profileId: string;
      generation: string;
      reasonCode: "identity_ready";
    };

export type ChatGptDesktopProfileResult =
  | {
      status: Exclude<ChatGptDesktopProfileStatus, { state: "ready" }>;
      profile?: never;
    }
  | {
      status: Extract<ChatGptDesktopProfileStatus, { state: "ready" }>;
      profile: Readonly<ChatGptDesktopProfile>;
    };

interface ProfileFileHandle {
  stat(): Promise<BigIntStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ChatGptDesktopProfileFs {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<ProfileFileHandle>;
}

export interface ChatGptDesktopProcessIdentity {
  uid: number;
  startTicks: string;
  state: string;
}

export interface ChatGptDesktopProfileOptions {
  /** Server startup configuration only; never pass an HTTP value here. */
  profileFile?: string;
  /** These injectable readers are intended for isolated tests. */
  fs?: ChatGptDesktopProfileFs;
  inspectProcess?: (pid: number) => Promise<ChatGptDesktopProcessIdentity>;
  uid?: number;
}

const defaultFs: ChatGptDesktopProfileFs = {
  // Only fixed metadata and the bounded profile file are read here. Keeping
  // these calls off the shared libuv pool preserves fresh checks during bursts.
  lstat: async (path) => lstatSync(path, { bigint: true }),
  realpath: async (path) => realpathSync(path),
  open: async (path, flags) => {
    const fd = openSync(path, flags);
    return {
      stat: async () => fstatSync(fd, { bigint: true }),
      read: async (buffer, offset, length, position) =>
        ({ bytesRead: readSync(fd, buffer, offset, length, position) }),
      close: async () => closeSync(fd),
    };
  },
};

class ProfileFailure extends Error {
  constructor(readonly reasonCode: FailureCode) {
    super(reasonCode);
  }
}

function fail(code: FailureCode): never {
  throw new ProfileFailure(code);
}

function canonical(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 1 &&
    value.length <= 4096 &&
    isAbsolute(value) &&
    resolve(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

function sameDirectory(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.uid === b.uid &&
    a.gid === b.gid
  );
}

/** Reject symlinks anywhere in a path; assets need not sit in a private project. */
async function noSymlinks(
  path: string,
  fs: ChatGptDesktopProfileFs,
  code: FailureCode,
): Promise<void> {
  if (!canonical(path)) fail(code);
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) fail(code);
  }
  if ((await fs.realpath(path)) !== path) fail(code);
}

async function privateDirectory(
  path: string,
  fs: ChatGptDesktopProfileFs,
  uid: number,
  code: FailureCode,
): Promise<BigIntStats> {
  await noSymlinks(path, fs, code);
  const info = await fs.lstat(path);
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(uid) ||
    (info.mode & 0o7777n) !== 0o700n
  )
    fail(code);
  return info;
}

function validateProfile(
  value: unknown,
  uid: number,
): Readonly<ChatGptDesktopProfile> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_profile");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = Object.hasOwn(record, "serverSshSocketPath") ? [...PROFILE_KEYS, "serverSshSocketPath"].sort() : PROFILE_KEYS;
  if (
    keys.length !== expected.length ||
    keys.some((key, i) => key !== expected[i])
  )
    fail("invalid_profile");
  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    !UUID.test(record.id) ||
    typeof record.generation !== "string" ||
    !UUID.test(record.generation) ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.uid !== "number" ||
    !Number.isSafeInteger(record.uid) ||
    record.uid < 0 ||
    record.uid !== uid ||
    typeof record.startTicks !== "string" ||
    !TICKS.test(record.startTicks) ||
    !canonical(record.macAsarPath) ||
    !canonical(record.linuxAsarPath) ||
    !canonical(record.controlSocketPath) ||
    (Object.hasOwn(record, "serverSshSocketPath") && (!canonical(record.serverSshSocketPath) || record.serverSshSocketPath.length > 100 || basename(record.serverSshSocketPath) !== "server-ssh.sock" || record.serverSshSocketPath === record.controlSocketPath)) ||
    typeof record.macAsarSha256 !== "string" ||
    !SHA256.test(record.macAsarSha256) ||
    typeof record.linuxAsarSha256 !== "string" ||
    !SHA256.test(record.linuxAsarSha256)
  )
    fail("invalid_profile");
  return Object.freeze({
    version: 1,
    id: record.id,
    generation: record.generation,
    pid: record.pid,
    startTicks: record.startTicks,
    uid: record.uid,
    macAsarPath: record.macAsarPath,
    macAsarSha256: record.macAsarSha256,
    linuxAsarPath: record.linuxAsarPath,
    linuxAsarSha256: record.linuxAsarSha256,
    controlSocketPath: record.controlSocketPath,
    ...(typeof record.serverSshSocketPath === "string" ? { serverSshSocketPath: record.serverSshSocketPath } : {}),
  });
}

function parseProcStat(
  text: string,
  pid: number,
): { state: string; startTicks: string } {
  const start = text.indexOf(" (");
  const end = text.lastIndexOf(") ");
  if (start < 1 || end <= start || text.slice(0, start) !== String(pid))
    throw new Error("invalid process stat");
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const state = fields[0];
  const startTicks = fields[19];
  if (
    !state ||
    !LIVE_PROCESS_STATE.test(state) ||
    !startTicks ||
    !TICKS.test(startTicks)
  )
    throw new Error("process unavailable");
  return { state, startTicks };
}

async function inspectLinuxProcess(
  pid: number,
): Promise<ChatGptDesktopProcessIdentity> {
  const directory = `/proc/${pid}`;
  const before = lstatSync(directory, { bigint: true });
  const first = parseProcStat(readFileSync(`${directory}/stat`, "utf8"), pid);
  const second = parseProcStat(
    readFileSync(`${directory}/stat`, "utf8"),
    pid,
  );
  const after = lstatSync(directory, { bigint: true });
  if (
    !before.isDirectory() ||
    !after.isDirectory() ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.uid !== after.uid ||
    first.startTicks !== second.startTicks
  )
    throw new Error("process identity changed");
  return {
    uid: Number(after.uid),
    startTicks: second.startTicks,
    state: second.state,
  };
}

async function readPrivateProfile(
  path: string,
  fs: ChatGptDesktopProfileFs,
  uid: number,
) {
  if (!canonical(path)) fail("invalid_profile_path");
  const parent = dirname(path);
  const parentInfo = await privateDirectory(
    parent,
    fs,
    uid,
    "unsafe_profile_directory",
  );
  await noSymlinks(path, fs, "unsafe_profile_file");
  const before = await fs.lstat(path);
  if (
    !before.isFile() ||
    before.uid !== BigInt(uid) ||
    (before.mode & 0o7777n) !== 0o600n ||
    before.size > BigInt(MAX_PROFILE_BYTES)
  )
    fail("unsafe_profile_file");
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (!sameIdentity(before, opened)) fail("profile_changed");
    const readSnapshot = async () => {
      const buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_PROFILE_BYTES) fail("unsafe_profile_file");
      return buffer.subarray(0, length);
    };
    const first = await readSnapshot();
    const middle = await handle.stat();
    const second = await readSnapshot();
    const after = await handle.stat();
    if (
      !sameIdentity(opened, middle) ||
      !sameIdentity(opened, after) ||
      BigInt(first.length) !== opened.size ||
      !first.equals(second)
    )
      fail("profile_changed");
    bytes = first;
  } finally {
    await handle.close();
  }
  await noSymlinks(path, fs, "profile_changed");
  const afterPath = await fs.lstat(path);
  const afterParent = await privateDirectory(
    parent,
    fs,
    uid,
    "profile_changed",
  );
  if (
    !sameIdentity(before, afterPath) ||
    !sameDirectory(parentInfo, afterParent)
  )
    fail("profile_changed");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("invalid_profile");
  }
  return { profile: validateProfile(value, uid), fileInfo: before, parentInfo };
}

async function asset(path: string, fs: ChatGptDesktopProfileFs): Promise<void> {
  await noSymlinks(path, fs, "unsafe_asset_path");
  if (!(await fs.lstat(path)).isFile()) fail("unsafe_asset_path");
}

async function controlSocket(
  path: string,
  fs: ChatGptDesktopProfileFs,
  uid: number,
): Promise<BigIntStats> {
  await noSymlinks(path, fs, "unsafe_control_socket");
  const info = await fs.lstat(path);
  if (
    !info.isSocket() ||
    info.uid !== BigInt(uid) ||
    (info.mode & 0o7777n) !== 0o600n
  )
    fail("unsafe_control_socket");
  return info;
}

/** The candidate creates this listener after reading the profile, so an absent
 * leaf is allowed. Its existing private parent and every present socket remain
 * fully checked; no directory/socket is created or connected by this reader. */
async function serverSshEndpoint(path: string, fs: ChatGptDesktopProfileFs, uid: number) {
  const directory = await privateDirectory(dirname(path), fs, uid, "unsafe_server_ssh_directory");
  let socket: BigIntStats | undefined;
  try { socket = await fs.lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("unsafe_server_ssh_socket"); }
  if (socket) {
    if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== BigInt(uid) || (socket.mode & 0o7777n) !== 0o600n) fail("unsafe_server_ssh_socket");
    await noSymlinks(path, fs, "unsafe_server_ssh_socket");
  }
  return { directory, socket };
}

function processMatches(
  actual: ChatGptDesktopProcessIdentity,
  profile: Readonly<ChatGptDesktopProfile>,
): boolean {
  return (
    actual.uid === profile.uid &&
    actual.startTicks === profile.startTicks &&
    typeof actual.state === "string" &&
    LIVE_PROCESS_STATE.test(actual.state)
  );
}

async function checkedProcess(
  inspect: (pid: number) => Promise<ChatGptDesktopProcessIdentity>,
  profile: Readonly<ChatGptDesktopProfile>,
): Promise<void> {
  try {
    if (!processMatches(await inspect(profile.pid), profile))
      fail("process_identity_unavailable");
  } catch {
    fail("process_identity_unavailable");
  }
}

/**
 * Captures the server's configured profile path once. Neither status nor validation
 * opens the control socket, contacts the native app, or starts any process.
 * The ready state establishes a point-in-time identity only; callers must recheck
 * it before any future operation. ASAR hashes here are syntax-checked, not rehashed.
 */
export function createChatGptDesktopProfileService(
  options: ChatGptDesktopProfileOptions = {},
) {
  const profileFile =
    options.profileFile ?? process.env.CHATGPT_DESKTOP_PROFILE_FILE;
  const fs = options.fs ?? defaultFs;
  const inspectProcess = options.inspectProcess ?? inspectLinuxProcess;
  const uid = options.uid ?? process.getuid?.();

  async function readValidated(): Promise<ChatGptDesktopProfileResult> {
    if (!profileFile)
      return {
        status: { state: "unconfigured", reasonCode: "not_configured" },
      };
    try {
      if (uid === undefined || !Number.isSafeInteger(uid) || uid < 0)
        fail("profile_unavailable");
      const { profile, fileInfo, parentInfo } = await readPrivateProfile(
        profileFile,
        fs,
        uid,
      );
      await asset(profile.macAsarPath, fs);
      await asset(profile.linuxAsarPath, fs);
      const controlDir = dirname(profile.controlSocketPath);
      const controlDirBefore = await privateDirectory(
        controlDir,
        fs,
        uid,
        "unsafe_control_directory",
      );
      const socketBefore = await controlSocket(
        profile.controlSocketPath,
        fs,
        uid,
      );
      const sshBefore = profile.serverSshSocketPath === undefined ? undefined : await serverSshEndpoint(profile.serverSshSocketPath, fs, uid);
      await checkedProcess(inspectProcess, profile);
      const socketAfter = await controlSocket(
        profile.controlSocketPath,
        fs,
        uid,
      );
      const controlDirAfter = await privateDirectory(
        controlDir,
        fs,
        uid,
        "unsafe_control_directory",
      );
      if (
        !sameIdentity(socketBefore, socketAfter) ||
        !sameDirectory(controlDirBefore, controlDirAfter)
      )
        fail("unsafe_control_socket");
      if (profile.serverSshSocketPath !== undefined && sshBefore) {
        const sshAfter = await serverSshEndpoint(profile.serverSshSocketPath, fs, uid);
        if (!sameDirectory(sshBefore.directory, sshAfter.directory)) fail("unsafe_server_ssh_directory");
        if (!!sshBefore.socket !== !!sshAfter.socket || (sshBefore.socket && sshAfter.socket && !sameIdentity(sshBefore.socket, sshAfter.socket))) fail("unsafe_server_ssh_socket");
      }
      await checkedProcess(inspectProcess, profile);
      await noSymlinks(profileFile, fs, "profile_changed");
      const finalFile = await fs.lstat(profileFile);
      const finalParent = await privateDirectory(
        dirname(profileFile),
        fs,
        uid,
        "profile_changed",
      );
      if (
        !sameIdentity(fileInfo, finalFile) ||
        !sameDirectory(parentInfo, finalParent)
      )
        fail("profile_changed");
      return {
        status: {
          state: "ready",
          profileId: profile.id,
          generation: profile.generation,
          reasonCode: "identity_ready",
        },
        profile,
      };
    } catch (error) {
      return {
        status: {
          state: "unavailable",
          reasonCode:
            error instanceof ProfileFailure
              ? error.reasonCode
              : "profile_unavailable",
        },
      };
    }
  }

  return {
    readValidated,
    async status(): Promise<ChatGptDesktopProfileStatus> {
      return (await readValidated()).status;
    },
  };
}
