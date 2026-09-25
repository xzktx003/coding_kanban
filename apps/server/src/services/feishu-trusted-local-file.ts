import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_REFERENCED_FILE_PATH_CHARACTERS = 2_048;

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

export function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_FILENAMES.has(lower) ||
    SENSITIVE_SUFFIXES.has(path.posix.extname(lower))
  );
}

export function isSensitivePath(filePath: string): boolean {
  return filePath.split("/").some((segment) => {
    return segment.startsWith(".") || isSensitiveFileName(segment);
  });
}

export function isSafeAbsolutePath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.length > MAX_REFERENCED_FILE_PATH_CHARACTERS ||
    !path.isAbsolute(filePath) ||
    filePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(filePath)
  ) {
    return false;
  }
  const segments = filePath.split("/");
  if (segments[0] !== "" || segments.length < 2) {
    return false;
  }
  const body = segments.slice(1);
  if (
    body.some((segment) => !segment || segment === "." || segment === "..") ||
    isSensitivePath(filePath)
  ) {
    return false;
  }
  return path.resolve(filePath) === filePath;
}

export async function resolveTrustedFileRoot(input: {
  workingDirectory: string;
  homeDirectory?: string;
}): Promise<string | null> {
  if (!input.workingDirectory || !path.isAbsolute(input.workingDirectory)) {
    return null;
  }
  const workspace = path.resolve(input.workingDirectory);
  const filesystemRoot = path.parse(workspace).root;
  const home = path.resolve(input.homeDirectory ?? homedir());
  if (workspace === filesystemRoot || workspace === home) {
    return null;
  }

  try {
    const workspaceStats = await lstat(workspace);
    if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
      return null;
    }
    const workspaceReal = await realpath(workspace);
    if (workspaceReal !== workspace) {
      return null;
    }

    const lexicalTrust = isContainedPath(home, workspaceReal)
      ? home
      : path.dirname(workspaceReal);
    if (lexicalTrust === filesystemRoot || lexicalTrust === workspaceReal) {
      return null;
    }
    const trustStats = await lstat(lexicalTrust);
    if (!trustStats.isDirectory() || trustStats.isSymbolicLink()) {
      return null;
    }
    const trustReal = await realpath(lexicalTrust);
    if (
      trustReal !== path.resolve(lexicalTrust) ||
      trustReal === filesystemRoot
    ) {
      return null;
    }
    return trustReal;
  } catch {
    return null;
  }
}
