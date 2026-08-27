import path from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

import type { FileEntryType } from "@agent-orchestrator/shared";

const DIRECTORY_MODE = 0o040000;
const SYMLINK_MODE = 0o120000;
const TYPE_MASK = 0o170000;
const EXECUTE_BITS = [0o100, 0o010, 0o001];
const WRITE_BITS = [0o200, 0o020, 0o002];
const READ_BITS = [0o400, 0o040, 0o004];
let passwdOwnerCache: Map<number, string> | null = null;

const MIME_TYPES = new Map<string, string>([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".log", "text/plain"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

function hasTraversalSegment(value: string): boolean {
  return value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .includes("..");
}

export function assertSafeFilesystemPath(value: string, field = "path"): void {
  if (!value.trim()) {
    throw new Error(`${field} is required`);
  }

  if (/[\0\r\n]/.test(value)) {
    throw new Error(`${field} contains invalid characters`);
  }

  if (hasTraversalSegment(value)) {
    throw new Error(`${field} cannot contain ".." segments`);
  }
}

export function detectFileEntryType(mode: number): FileEntryType {
  if ((mode & TYPE_MASK) === DIRECTORY_MODE) {
    return "directory";
  }

  if ((mode & TYPE_MASK) === SYMLINK_MODE) {
    return "symlink";
  }

  return "file";
}

export function formatPermissions(mode: number, type: FileEntryType): string {
  const typeChar = type === "directory" ? "d" : type === "symlink" ? "l" : "-";
  const permissionBits = [
    [READ_BITS[0], WRITE_BITS[0], EXECUTE_BITS[0]],
    [READ_BITS[1], WRITE_BITS[1], EXECUTE_BITS[1]],
    [READ_BITS[2], WRITE_BITS[2], EXECUTE_BITS[2]],
  ]
    .map(([readBit, writeBit, executeBit]) =>
      [
        mode & readBit ? "r" : "-",
        mode & writeBit ? "w" : "-",
        mode & executeBit ? "x" : "-",
      ].join(""),
    )
    .join("");

  return `${typeChar}${permissionBits}`;
}

function readPasswdOwners(): Map<number, string> {
  if (passwdOwnerCache) {
    return passwdOwnerCache;
  }

  const owners = new Map<number, string>();
  try {
    const content = readFileSync("/etc/passwd", "utf8");
    for (const line of content.split("\n")) {
      const [name, , uid] = line.split(":");
      const numericUid = Number(uid);
      if (name && Number.isInteger(numericUid)) {
        owners.set(numericUid, name);
      }
    }
  } catch {
    // Non-Unix hosts or restricted containers can still display numeric uid.
  }

  passwdOwnerCache = owners;
  return owners;
}

export function formatLocalOwner(uid?: number): string {
  if (!Number.isInteger(uid)) {
    return "—";
  }

  const numericUid = Number(uid);
  return readPasswdOwners().get(numericUid) ?? String(numericUid);
}

export function formatRemoteOwner(uid?: number, longname?: string): string {
  const longnameOwner = longname?.trim().split(/\s+/)[2];
  if (longnameOwner) {
    return longnameOwner;
  }

  return Number.isInteger(uid) ? String(Number(uid)) : "—";
}

export function guessMimeType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES.get(extension) ?? null;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.posix.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.posix.isAbsolute(relative))
  );
}

export function assertPathInside(
  rootPath: string,
  candidatePath: string,
): void {
  if (!isPathInside(rootPath, candidatePath)) {
    throw new Error("Markdown image is outside the file browser root");
  }
}

export function resolveMarkdownImagePath(input: {
  documentPath: string;
  rootPath: string;
  source: string;
}): string {
  const documentPath = path.posix.normalize(input.documentPath);
  const rootPath = path.posix.normalize(input.rootPath);
  const sourceWithoutSuffix = input.source.split(/[?#]/, 1)[0]?.trim() ?? "";
  let source: string;

  try {
    source = decodeURIComponent(sourceWithoutSuffix);
  } catch {
    throw new Error("Markdown image path has invalid URL encoding");
  }

  if (
    !source ||
    /[\0\r\n\\]/.test(source) ||
    /^[a-z][a-z\d+.-]*:/i.test(source) ||
    source.startsWith("//")
  ) {
    throw new Error("source must be a local Markdown image path");
  }

  assertPathInside(rootPath, documentPath);
  const normalizedAbsoluteSource = path.posix.normalize(source);
  const resolvedPath = source.startsWith("/")
    ? isPathInside(rootPath, normalizedAbsoluteSource)
      ? normalizedAbsoluteSource
      : path.posix.normalize(path.posix.join(rootPath, source.slice(1)))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(documentPath), source),
      );
  assertPathInside(rootPath, resolvedPath);
  return resolvedPath;
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  for (const value of buffer.values()) {
    if (value === 0) {
      return true;
    }
  }

  return false;
}

export function normalizeLocalPath(inputPath: string): string {
  assertSafeFilesystemPath(inputPath);
  if (inputPath === "~") {
    return homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.resolve(homedir(), inputPath.slice(2));
  }

  return path.resolve(inputPath);
}

export const VALID_CHMOD_PATTERN = /^[0-7]{3,4}$/;

export function validateChmodMode(mode: string): number {
  if (!VALID_CHMOD_PATTERN.test(mode)) {
    throw new Error("mode must be a valid octal permission (e.g. 755, 644)");
  }

  const parsed = Number.parseInt(mode, 8);

  const others = parsed & 0o007;
  const setuid = parsed & 0o4000;
  const setgid = parsed & 0o2000;
  const sticky = parsed & 0o1000;

  if (others === 0o007 && (setuid || setgid)) {
    throw new Error("mode cannot combine world-writable with setuid/setgid");
  }

  if (sticky && others !== 0o007 && others !== 0o000) {
    throw new Error(
      "sticky bit is only meaningful with world-writable directories",
    );
  }

  return parsed;
}

export function joinRemotePath(basePath: string, nextPath: string): string {
  if (nextPath.startsWith("/")) {
    return nextPath;
  }

  if (basePath === "/") {
    return `/${nextPath}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${nextPath}`;
}
