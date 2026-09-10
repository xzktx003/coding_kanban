import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  type FileHandle,
  lstat,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export interface FeishuWorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

export interface FeishuWorkspaceListResult {
  entries: FeishuWorkspaceEntry[];
  truncated: boolean;
}

export interface FeishuWorkspaceReadResult {
  content: string;
  revision: string;
  editable: boolean;
}

export interface FeishuWorkspaceDownloadResult {
  name: string;
  data: Buffer;
}

export interface FeishuWorkspaceFilesOptions {
  beforeExistingReplace?: () => Promise<void> | void;
}

const MAX_LIST_ENTRIES = 200;
const MAX_LIST_SCANNED_ENTRIES = 2000;
const MAX_READ_BYTES = 128 * 1024;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EDITABLE_UNICODE_CHARS = 1000;
const PROC_SELF_FD = "/proc/self/fd";
const SENSITIVE_SUFFIXES = new Set([
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
]);
const SENSITIVE_FILENAMES = new Set([
  "authorized_keys",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519",
  "id_rsa",
  "id_xmss",
  "known_hosts",
  "netrc",
  "npmrc",
]);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function isRemoteSession(session: AgentSessionRecord): boolean {
  return Boolean(
    session.sshTarget || (session.hostId && session.hostId !== "local"),
  );
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sameFile(
  left: Pick<Awaited<ReturnType<FileHandle["stat"]>>, "dev" | "ino">,
  right: Pick<Awaited<ReturnType<FileHandle["stat"]>>, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function fdPath(directory: FileHandle, name?: string): string {
  const base = path.join(PROC_SELF_FD, String(directory.fd));
  return name ? path.join(base, name) : base;
}

function assertLocalSession(session: AgentSessionRecord): void {
  if (isRemoteSession(session)) {
    throw new Error(
      "Remote workspace files are not supported until the SFTP layer can enforce safe no-follow revisioned writes",
    );
  }
}

function assertSafeRelativePath(relativePath: string): string[] {
  if (!relativePath.trim()) {
    throw new Error("Invalid path: path is required");
  }
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    /[\0-\x1f\x7f]/.test(relativePath)
  ) {
    throw new Error("Invalid path: must be a safe relative path");
  }

  const rawSegments = relativePath.split("/");
  if (rawSegments.some((segment) => segment === "..")) {
    throw new Error("Invalid path: traversal segments are not allowed");
  }

  const normalized = path.posix.normalize(relativePath);
  const segments = normalized
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Invalid path: traversal segments are not allowed");
  }
  for (const segment of segments) {
    if (segment.startsWith(".")) {
      throw new Error("Access denied: hidden paths are not exposed to Feishu");
    }
    assertNotSensitiveName(segment);
  }
  return segments;
}

function assertNotSensitiveName(name: string): void {
  if (isSensitiveName(name)) {
    throw new Error(
      "Access denied: credential-like files are not exposed to Feishu",
    );
  }
}

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_FILENAMES.has(lower) ||
    SENSITIVE_SUFFIXES.has(path.extname(lower))
  );
}

function toRelativeOutputPath(segments: string[]): string {
  return segments.join("/");
}

async function resolveRoot(session: AgentSessionRecord): Promise<string> {
  assertLocalSession(session);
  const root = session.workingDirectory;
  if (!root || !path.isAbsolute(root)) {
    throw new Error(
      "Invalid workspace root: session workingDirectory must be absolute",
    );
  }

  const normalizedRoot = path.resolve(root);
  if (normalizedRoot === path.parse(normalizedRoot).root) {
    throw new Error("Invalid workspace root: filesystem root is not allowed");
  }
  if (normalizedRoot === path.resolve(homedir())) {
    throw new Error("Invalid workspace root: home directory is not allowed");
  }

  const rootStats = await lstat(normalizedRoot);
  if (rootStats.isSymbolicLink()) {
    throw new Error("Invalid workspace root: symlink roots are not allowed");
  }
  if (!rootStats.isDirectory()) {
    throw new Error("Invalid workspace root: root must be a directory");
  }

  const resolvedRoot = await realpath(normalizedRoot);
  if (resolvedRoot !== normalizedRoot) {
    throw new Error("Invalid workspace root: symlink roots are not allowed");
  }
  return resolvedRoot;
}

async function openDirectoryNoFollow(fullPath: string): Promise<FileHandle> {
  return open(
    fullPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
}

async function openVerifiedDirectoryChain(input: {
  root: string;
  segments: string[];
}): Promise<{
  directory: FileHandle;
  directoryPath: string;
  root: FileHandle;
  rootStats: Awaited<ReturnType<FileHandle["stat"]>>;
  directoryStats: Awaited<ReturnType<FileHandle["stat"]>>;
}> {
  const root = await openDirectoryNoFollow(input.root);
  let directory: FileHandle | null = null;
  try {
    const rootStats = await root.stat();
    if (!rootStats.isDirectory()) {
      throw new Error("Invalid workspace root: root must be a directory");
    }

    directory = root;
    let directoryPath = input.root;
    for (const segment of input.segments) {
      const childPath = fdPath(directory, segment);
      const childStats = await lstat(childPath);
      if (childStats.isSymbolicLink()) {
        throw new Error(
          "Access denied: symlink paths are not exposed to Feishu",
        );
      }
      if (!childStats.isDirectory()) {
        throw new Error("Invalid path: intermediate path is not a directory");
      }
      const child = await openDirectoryNoFollow(childPath);
      if (directory !== root) {
        await directory.close();
      }
      directory = child;
      directoryPath = path.join(directoryPath, segment);
    }

    const [latestRootStats, directoryPathStats, directoryStats] =
      await Promise.all([
        lstat(input.root),
        lstat(directoryPath),
        directory.stat(),
      ]);
    if (
      !sameFile(rootStats, latestRootStats) ||
      !sameFile(directoryStats, directoryPathStats)
    ) {
      throw new Error(
        "Workspace path changed while resolving Feishu file access",
      );
    }

    const resolvedRoot = await realpath(input.root);
    if (resolvedRoot !== input.root) {
      throw new Error(
        "Workspace root changed while resolving Feishu file access",
      );
    }

    return {
      directory,
      directoryPath,
      root,
      rootStats,
      directoryStats,
    };
  } catch (error) {
    if (directory && directory !== root) {
      await directory.close().catch(() => undefined);
    }
    await root.close().catch(() => undefined);
    throw error;
  }
}

async function closeVerifiedDirectoryChain(input: {
  directory: FileHandle;
  root: FileHandle;
}): Promise<void> {
  if (input.directory !== input.root) {
    await input.directory.close();
  }
  await input.root.close();
}

async function revalidateDirectoryChain(input: {
  rootPath: string;
  directoryPath: string;
  root: FileHandle;
  rootStats: Awaited<ReturnType<FileHandle["stat"]>>;
  directory: FileHandle;
  directoryStats: Awaited<ReturnType<FileHandle["stat"]>>;
}): Promise<void> {
  const [
    latestRootStats,
    latestDirectoryStats,
    openedRootStats,
    openedDirectoryStats,
  ] = await Promise.all([
    lstat(input.rootPath),
    lstat(input.directoryPath),
    input.root.stat(),
    input.directory.stat(),
  ]);
  if (
    !sameFile(input.rootStats, openedRootStats) ||
    !sameFile(input.directoryStats, openedDirectoryStats) ||
    !sameFile(input.rootStats, latestRootStats) ||
    !sameFile(input.directoryStats, latestDirectoryStats)
  ) {
    throw new Error(
      "Workspace path changed while resolving Feishu file access",
    );
  }
}

async function openParentDirectory(input: {
  root: string;
  segments: string[];
}): Promise<{
  parent: Awaited<ReturnType<typeof openVerifiedDirectoryChain>>;
  name: string;
}> {
  if (input.segments.length === 0) {
    throw new Error("Invalid path: root cannot be written as a file");
  }
  const parentSegments = input.segments.slice(0, -1);
  return {
    parent: await openVerifiedDirectoryChain({
      root: input.root,
      segments: parentSegments,
    }),
    name: input.segments[input.segments.length - 1]!,
  };
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

async function assertExistingLeafIsNotSymlink(input: {
  directory: FileHandle;
  name: string;
}): Promise<void> {
  const stats = await lstat(fdPath(input.directory, input.name));
  if (stats.isSymbolicLink()) {
    throw new Error("Access denied: symlink paths are not exposed to Feishu");
  }
}

async function readFileBoundedNoFollow(input: {
  directory: FileHandle;
  name: string;
  maxBytes: number;
  tooLargeMessage: string;
}): Promise<Buffer> {
  await assertExistingLeafIsNotSymlink(input);
  const file = await open(
    fdPath(input.directory, input.name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new Error("Invalid path: expected a regular file");
    }
    if (stats.size > input.maxBytes) {
      throw new Error(input.tooLargeMessage);
    }

    const buffer = Buffer.alloc(input.maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > input.maxBytes) {
      throw new Error(input.tooLargeMessage);
    }
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function readExistingForWrite(input: {
  directory: FileHandle;
  name: string;
}): Promise<{
  buffer: Buffer;
  identity: Pick<Awaited<ReturnType<FileHandle["stat"]>>, "dev" | "ino">;
  mode: number;
  revision: string;
}> {
  await assertExistingLeafIsNotSymlink(input);
  const file = await open(
    fdPath(input.directory, input.name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new Error("Invalid path: expected a regular file");
    }
    if (stats.nlink > 1) {
      throw new Error(
        "Access denied: hardlinked files cannot be written from Feishu",
      );
    }
    if (stats.size > MAX_READ_BYTES) {
      throw new Error("File is too large to edit through Feishu");
    }
    const buffer = Buffer.alloc(MAX_READ_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > MAX_READ_BYTES) {
      throw new Error("File is too large to edit through Feishu");
    }
    return {
      buffer: buffer.subarray(0, offset),
      identity: { dev: stats.dev, ino: stats.ino },
      mode: stats.mode & 0o777,
      revision: sha256(buffer.subarray(0, offset)),
    };
  } finally {
    await file.close();
  }
}

function assertSafeWriteContent(content: string): void {
  if (unicodeLength(content) > MAX_EDITABLE_UNICODE_CHARS) {
    throw new Error("File content is too large to edit through Feishu");
  }
  if (/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) {
    throw new Error("File content contains unsupported control characters");
  }
  if (content.includes("\ufffd")) {
    throw new Error(
      "File content contains invalid UTF-8 replacement characters",
    );
  }
}

export class FeishuWorkspaceFiles {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: FeishuWorkspaceFilesOptions = {}) {}

  async list(
    session: AgentSessionRecord,
    relativePath: string,
  ): Promise<FeishuWorkspaceListResult> {
    const root = await resolveRoot(session);
    const segments = assertSafeRelativePath(relativePath);
    const directory = await openVerifiedDirectoryChain({ root, segments });
    try {
      await revalidateDirectoryChain({
        rootPath: root,
        directoryPath: directory.directoryPath,
        root: directory.root,
        rootStats: directory.rootStats,
        directory: directory.directory,
        directoryStats: directory.directoryStats,
      });
      const entries: FeishuWorkspaceEntry[] = [];
      let truncated = false;
      let scanned = 0;

      const dir = await opendir(fdPath(directory.directory));
      try {
        for await (const item of dir) {
          scanned += 1;
          if (scanned > MAX_LIST_SCANNED_ENTRIES) {
            truncated = true;
            break;
          }
          const name = item.name;
          if (name === "." || name === ".." || name.startsWith(".")) {
            continue;
          }
          if (isSensitiveName(name)) {
            continue;
          }
          if (entries.length >= MAX_LIST_ENTRIES) {
            truncated = true;
            break;
          }
          const stats = await lstat(fdPath(directory.directory, name));
          if (stats.isSymbolicLink()) {
            continue;
          }
          if (!stats.isFile() && !stats.isDirectory()) {
            continue;
          }
          entries.push({
            name,
            path: toRelativeOutputPath([...segments, name]),
            type: stats.isDirectory() ? "directory" : "file",
            size: stats.isDirectory() ? 0 : stats.size,
          });
        }
      } finally {
        await dir.close().catch(() => undefined);
      }

      return {
        entries: entries.sort((left, right) => {
          if (left.type === "directory" && right.type !== "directory")
            return -1;
          if (left.type !== "directory" && right.type === "directory") return 1;
          return left.name.localeCompare(right.name);
        }),
        truncated,
      };
    } finally {
      await closeVerifiedDirectoryChain(directory);
    }
  }

  async read(
    session: AgentSessionRecord,
    relativePath: string,
  ): Promise<FeishuWorkspaceReadResult> {
    const root = await resolveRoot(session);
    const segments = assertSafeRelativePath(relativePath);
    const { parent, name } = await openParentDirectory({ root, segments });
    try {
      await revalidateDirectoryChain({
        rootPath: root,
        directoryPath: parent.directoryPath,
        root: parent.root,
        rootStats: parent.rootStats,
        directory: parent.directory,
        directoryStats: parent.directoryStats,
      });
      const buffer = await readFileBoundedNoFollow({
        directory: parent.directory,
        name,
        maxBytes: MAX_READ_BYTES,
        tooLargeMessage: "File is too large to read through Feishu",
      });

      let content: string;
      try {
        content = utf8Decoder.decode(buffer);
      } catch {
        throw new Error("File must be valid UTF-8 to read through Feishu");
      }

      return {
        content,
        revision: sha256(buffer),
        editable: unicodeLength(content) <= MAX_EDITABLE_UNICODE_CHARS,
      };
    } finally {
      await closeVerifiedDirectoryChain(parent);
    }
  }

  async write(
    session: AgentSessionRecord,
    relativePath: string,
    content: string,
    expectedRevision: string | null,
  ): Promise<void> {
    assertSafeWriteContent(content);
    const root = await resolveRoot(session);
    const segments = assertSafeRelativePath(relativePath);
    const lockKey = `${root}\0${toRelativeOutputPath(segments)}`;
    const previous = this.writeLocks.get(lockKey) ?? Promise.resolve();
    const next = previous.then(async () => {
      const { parent, name } = await openParentDirectory({ root, segments });
      try {
        await revalidateDirectoryChain({
          rootPath: root,
          directoryPath: parent.directoryPath,
          root: parent.root,
          rootStats: parent.rootStats,
          directory: parent.directory,
          directoryStats: parent.directoryStats,
        });
        await this.writeUnlocked({
          revalidateParent: () =>
            revalidateDirectoryChain({
              rootPath: root,
              directoryPath: parent.directoryPath,
              root: parent.root,
              rootStats: parent.rootStats,
              directory: parent.directory,
              directoryStats: parent.directoryStats,
            }),
          directory: parent.directory,
          name,
          content,
          expectedRevision,
        });
      } finally {
        await closeVerifiedDirectoryChain(parent);
      }
    });
    const stored = next.catch(() => undefined);
    this.writeLocks.set(lockKey, stored);

    try {
      await next;
    } finally {
      if (this.writeLocks.get(lockKey) === stored) {
        this.writeLocks.delete(lockKey);
      }
    }
  }

  async download(
    session: AgentSessionRecord,
    relativePath: string,
  ): Promise<FeishuWorkspaceDownloadResult> {
    const root = await resolveRoot(session);
    const segments = assertSafeRelativePath(relativePath);
    const { parent, name } = await openParentDirectory({ root, segments });
    try {
      await revalidateDirectoryChain({
        rootPath: root,
        directoryPath: parent.directoryPath,
        root: parent.root,
        rootStats: parent.rootStats,
        directory: parent.directory,
        directoryStats: parent.directoryStats,
      });
      const data = await readFileBoundedNoFollow({
        directory: parent.directory,
        name,
        maxBytes: MAX_DOWNLOAD_BYTES,
        tooLargeMessage: "File is too large to download through Feishu",
      });

      return {
        name,
        data,
      };
    } finally {
      await closeVerifiedDirectoryChain(parent);
    }
  }

  private async writeUnlocked(input: {
    revalidateParent: () => Promise<void>;
    directory: FileHandle;
    name: string;
    content: string;
    expectedRevision: string | null;
  }): Promise<void> {
    const data = Buffer.from(input.content, "utf8");

    if (input.expectedRevision === null) {
      try {
        await assertExistingLeafIsNotSymlink({
          directory: input.directory,
          name: input.name,
        });
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
      const file = await open(
        fdPath(input.directory, input.name),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(data);
      } finally {
        await file.close();
      }
      return;
    }

    if (!/^[a-f0-9]{64}$/.test(input.expectedRevision)) {
      throw new Error("Invalid revision");
    }

    const current = await readExistingForWrite({
      directory: input.directory,
      name: input.name,
    });
    if (current.revision !== input.expectedRevision) {
      throw new Error("File changed since it was read");
    }

    const recheckRevision = async (): Promise<void> => {
      await input.revalidateParent();
      const latest = await readExistingForWrite({
        directory: input.directory,
        name: input.name,
      });
      if (
        latest.revision !== current.revision ||
        !sameFile(latest.identity, current.identity)
      ) {
        throw new Error("File changed since it was read");
      }
    };

    const tempName = `.${input.name}.kanban-${process.pid}-${randomBytes(8).toString("hex")}.tmp`;
    let tempCreated = false;
    try {
      const temp = await open(
        fdPath(input.directory, tempName),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        current.mode,
      );
      tempCreated = true;
      try {
        await temp.writeFile(data);
      } finally {
        await temp.close();
      }
      await chmod(fdPath(input.directory, tempName), current.mode);
      await this.options.beforeExistingReplace?.();
      await recheckRevision();
      await rename(
        fdPath(input.directory, tempName),
        fdPath(input.directory, input.name),
      );
      tempCreated = false;
    } finally {
      if (tempCreated) {
        await rm(fdPath(input.directory, tempName), { force: true });
      }
    }
  }
}
