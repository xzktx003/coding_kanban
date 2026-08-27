import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  chmod,
} from "node:fs/promises";
import path from "node:path";

import type {
  FileEntry,
  FilePreviewResponse,
  ListFilesResponse,
} from "@agent-orchestrator/shared";

import {
  assertSafeFilesystemPath,
  formatLocalOwner,
  formatPermissions,
  normalizeLocalPath,
  validateChmodMode,
} from "./file-system-utils.js";
import {
  buildFilePreviewResponse,
  normalizeFilePreviewWindow,
} from "./file-preview-window.js";

function toFileEntry(
  entryPath: string,
  stats: Awaited<ReturnType<typeof lstat>>,
  symlinkTargetType?: "file" | "directory",
): FileEntry {
  const type = stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : "file";

  return {
    name: path.basename(entryPath),
    path: entryPath,
    type,
    size: stats.isDirectory() ? 0 : Number(stats.size),
    modifiedAt: stats.mtime.toISOString(),
    owner: formatLocalOwner(Number(stats.uid)),
    permissions: formatPermissions(Number(stats.mode), type),
    isHidden: path.basename(entryPath).startsWith("."),
    ...(type === "symlink" && symlinkTargetType ? { symlinkTargetType } : {}),
  };
}

export class LocalFsService {
  async list(
    inputPath: string,
    showHidden = false,
  ): Promise<ListFilesResponse> {
    const resolvedPath = normalizeLocalPath(inputPath);
    const entries = await readdir(resolvedPath);
    const results = await Promise.all(
      entries.map(async (name) => {
        const entryPath = path.join(resolvedPath, name);
        const stats = await lstat(entryPath);
        let symlinkTargetType: "file" | "directory" | undefined;
        if (stats.isSymbolicLink()) {
          try {
            const targetStats = await stat(entryPath);
            symlinkTargetType = targetStats.isDirectory()
              ? "directory"
              : "file";
          } catch {
            // broken symlink — leave symlinkTargetType undefined
          }
        }
        return toFileEntry(entryPath, stats, symlinkTargetType);
      }),
    );

    return {
      path: resolvedPath,
      entries: results
        .filter((entry: FileEntry) => showHidden || !entry.isHidden)
        .sort((left: FileEntry, right: FileEntry) => {
          const leftIsDir =
            left.type === "directory" || left.symlinkTargetType === "directory";
          const rightIsDir =
            right.type === "directory" ||
            right.symlinkTargetType === "directory";
          if (leftIsDir && !rightIsDir) {
            return -1;
          }

          if (!leftIsDir && rightIsDir) {
            return 1;
          }

          return left.name.localeCompare(right.name);
        }),
    };
  }

  async mkdir(inputPath: string): Promise<string> {
    const resolvedPath = normalizeLocalPath(inputPath);
    await mkdir(resolvedPath, { recursive: true });
    return resolvedPath;
  }

  async rename(fromPath: string, toPath: string): Promise<string> {
    const resolvedFromPath = normalizeLocalPath(fromPath);
    const resolvedToPath = normalizeLocalPath(toPath);
    await rename(resolvedFromPath, resolvedToPath);
    return resolvedToPath;
  }

  async remove(inputPath: string): Promise<void> {
    const resolvedPath = normalizeLocalPath(inputPath);
    await rm(resolvedPath, { recursive: true, force: false });
  }

  createReadStream(inputPath: string) {
    return createReadStream(normalizeLocalPath(inputPath));
  }

  async getFileMetadata(inputPath: string): Promise<{
    isDirectory: boolean;
    size: number;
  }> {
    const stats = await stat(normalizeLocalPath(inputPath));
    return { isDirectory: stats.isDirectory(), size: stats.size };
  }

  createWriteStream(inputPath: string) {
    const resolvedPath = normalizeLocalPath(inputPath);
    return createWriteStream(resolvedPath);
  }

  resolvePath(inputPath: string): string {
    return normalizeLocalPath(inputPath);
  }

  async preview(
    inputPath: string,
    maxBytes?: number,
    offset?: number,
  ): Promise<FilePreviewResponse> {
    const resolvedPath = normalizeLocalPath(inputPath);
    const fileHandle = await open(resolvedPath, "r");

    try {
      const fileStats = await stat(resolvedPath);
      const window = normalizeFilePreviewWindow(
        fileStats.size,
        maxBytes,
        offset,
      );
      const buffer = Buffer.alloc(window.readBytes);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        window.readBytes,
        window.offset,
      );

      return buildFilePreviewResponse({
        path: resolvedPath,
        buffer: buffer.subarray(0, bytesRead),
        fileSize: fileStats.size,
        offset: window.offset,
        maxBytes: window.maxBytes,
      });
    } finally {
      await fileHandle.close();
    }
  }

  async chmod(inputPath: string, mode: string): Promise<void> {
    assertSafeFilesystemPath(inputPath, "path");
    const parsedMode = validateChmodMode(mode);
    await chmod(normalizeLocalPath(inputPath), parsedMode);
  }
}
