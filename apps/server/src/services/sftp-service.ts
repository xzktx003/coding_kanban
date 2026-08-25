import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { Client } from "ssh2";
import type { Attributes, SFTPWrapper } from "ssh2";

import type {
  FileEntry,
  FilePreviewResponse,
  ListFilesResponse,
  SshTarget,
} from "@agent-orchestrator/shared";

import {
  assertSafeFilesystemPath,
  detectFileEntryType,
  formatRemoteOwner,
  formatPermissions,
  joinRemotePath,
  validateChmodMode,
} from "./file-system-utils.js";
import {
  buildFilePreviewResponse,
  normalizeFilePreviewWindow,
} from "./file-preview-window.js";

interface PooledConnection {
  client: Client;
  homePath: Promise<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  ready: Promise<void>;
}

const DEFAULT_SSH_IDENTITY_FILES = [
  "id_ed25519",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_rsa",
  "id_dsa",
  "id_xmss",
] as const;

const MAX_SFTP_READ_RANGE_BYTES = 4 * 1024 * 1024;

export interface SftpRecursiveFileEntry {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface SftpReadRange {
  path: string;
  size: number;
  buffer: Buffer;
}

export interface SftpAuthenticationDependencies {
  homeDirectory: string;
  env: Record<string, string | undefined>;
  fileExists: (pathValue: string) => boolean;
  readFile: (pathValue: string) => Buffer;
}

function findDefaultIdentityFile(
  dependencies: SftpAuthenticationDependencies,
): string | undefined {
  for (const candidate of DEFAULT_SSH_IDENTITY_FILES) {
    const pathValue = `${dependencies.homeDirectory}/.ssh/${candidate}`;
    if (dependencies.fileExists(pathValue)) {
      return pathValue;
    }
  }

  return undefined;
}

export function resolveSftpAuthenticationOptions(
  target: SshTarget,
  dependencies: SftpAuthenticationDependencies = {
    homeDirectory: homedir(),
    env: process.env,
    fileExists: existsSync,
    readFile: readFileSync,
  },
): { privateKey?: Buffer; agent?: string } {
  const identityFile =
    target.identityFile ?? findDefaultIdentityFile(dependencies);
  const agent = dependencies.env.SSH_AUTH_SOCK;

  return {
    ...(identityFile
      ? { privateKey: dependencies.readFile(identityFile) }
      : {}),
    ...(agent ? { agent } : {}),
  };
}

function createConnectionKey(target: SshTarget): string {
  const username = target.username ?? "default";
  const port = target.port ?? 22;
  const identityFile = target.identityFile ?? "";
  return `${username}@${target.host}:${port}:${identityFile}`;
}

function attrsToFileEntry(
  basePath: string,
  name: string,
  attrs: Attributes,
  longname?: string,
  symlinkTargetType?: "file" | "directory",
): FileEntry {
  const typeFromLongname = longname?.startsWith("d")
    ? "directory"
    : longname?.startsWith("l")
      ? "symlink"
      : undefined;
  const type = typeFromLongname ?? detectFileEntryType(attrs.mode ?? 0);
  const modifiedAt = new Date(((attrs.mtime ?? 0) || 0) * 1000).toISOString();

  return {
    name,
    path: joinRemotePath(basePath, name),
    type,
    size: type === "directory" ? 0 : (attrs.size ?? 0),
    modifiedAt,
    owner: formatRemoteOwner(attrs.uid, longname),
    permissions: formatPermissions(attrs.mode ?? 0, type),
    isHidden: name.startsWith("."),
    ...(type === "symlink" && symlinkTargetType ? { symlinkTargetType } : {}),
  };
}

function withSftp<T>(
  client: Client,
  callback: (sftp: SFTPWrapper) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      callback(sftp)
        .then((result) => {
          sftp.end();
          resolve(result);
        })
        .catch((error) => {
          sftp.end();
          reject(error);
        });
    });
  });
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(sftp);
    });
  });
}

function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<Attributes> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stats);
    });
  });
}

async function readSftpRange(
  sftp: SFTPWrapper,
  remotePath: string,
  offset: number,
  length: number,
): Promise<SftpReadRange> {
  const fileStats = await sftpStat(sftp, remotePath);
  const fileSize = Math.max(0, fileStats.size ?? 0);
  const start = Math.min(offset, fileSize);
  const end = Math.min(fileSize, start + length);
  if (end <= start) {
    return { path: remotePath, size: fileSize, buffer: Buffer.alloc(0) };
  }

  const handle = await new Promise<Buffer>((resolve, reject) => {
    sftp.open(remotePath, "r", (error, openedHandle) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(openedHandle);
    });
  });

  try {
    const buffer = Buffer.alloc(end - start);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await new Promise<number>((resolve, reject) => {
        sftp.read(
          handle,
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          start + bytesRead,
          (error, readBytes) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(readBytes);
          },
        );
      });
      if (result <= 0) {
        break;
      }
      bytesRead += result;
    }

    return {
      path: remotePath,
      size: fileSize,
      buffer: buffer.subarray(0, bytesRead),
    };
  } finally {
    await new Promise<void>((resolve) => {
      sftp.close(handle, () => resolve());
    });
  }
}

function sftpReaddir(
  sftp: SFTPWrapper,
  remotePath: string,
): Promise<Array<{ filename: string; longname: string; attrs: Attributes }>> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, items) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(items ?? []);
    });
  });
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sftpRename(
  sftp: SFTPWrapper,
  fromPath: string,
  toPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(fromPath, toPath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sftpChmod(
  sftp: SFTPWrapper,
  remotePath: string,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(remotePath, mode, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export class SftpService {
  private readonly connections = new Map<string, PooledConnection>();

  constructor(
    private readonly clientFactory: () => Client = () => new Client(),
    private readonly idleTimeoutMs = 5 * 60 * 1000,
  ) {}

  async list(
    target: SshTarget,
    inputPath: string,
    showHidden = false,
  ): Promise<ListFilesResponse> {
    const remotePath = await this.resolveRemotePath(target, inputPath);

    return this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        const items = await sftpReaddir(sftp, remotePath);
        const entries = await Promise.all(
          items.map(async (item) => {
            let symlinkTargetType: "file" | "directory" | undefined;
            const typeFromLongname = item.longname?.startsWith("l");
            const typeFromMode =
              detectFileEntryType(item.attrs.mode ?? 0) === "symlink";
            if (typeFromLongname || typeFromMode) {
              try {
                const targetPath = joinRemotePath(remotePath, item.filename);
                const targetStats = await sftpStat(sftp, targetPath);
                if (((targetStats.mode ?? 0) & 0o170000) === 0o040000) {
                  symlinkTargetType = "directory";
                } else {
                  symlinkTargetType = "file";
                }
              } catch {
                // broken symlink
              }
            }
            return attrsToFileEntry(
              remotePath,
              item.filename,
              item.attrs,
              item.longname,
              symlinkTargetType,
            );
          }),
        );
        const filtered = entries
          .filter((entry) => showHidden || !entry.isHidden)
          .sort((left, right) => {
            const leftIsDir =
              left.type === "directory" ||
              left.symlinkTargetType === "directory";
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
          });

        return { path: remotePath, entries: filtered };
      }),
    );
  }

  async mkdir(target: SshTarget, inputPath: string): Promise<string> {
    const remotePath = await this.resolveRemotePath(target, inputPath);

    await this.withConnection(target, async (client) =>
      withSftp(client, (sftp) => sftpMkdir(sftp, remotePath)),
    );

    return remotePath;
  }

  async ensureDirectory(target: SshTarget, inputPath: string): Promise<void> {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    const segments = remotePath.split("/").filter(Boolean);
    let current = remotePath.startsWith("/") ? "/" : "";

    await this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        for (const segment of segments) {
          current = current ? `${current}/${segment}` : segment;
          try {
            await sftpStat(sftp, current);
          } catch {
            await sftpMkdir(sftp, current);
          }
        }
      }),
    );
  }

  async isDirectory(target: SshTarget, inputPath: string): Promise<boolean> {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    return this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        const stats = await sftpStat(sftp, remotePath);
        return (stats.mode & 0o40000) !== 0;
      }),
    );
  }

  async listRecursive(
    target: SshTarget,
    inputPath: string,
  ): Promise<SftpRecursiveFileEntry[]> {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    const results: SftpRecursiveFileEntry[] = [];

    await this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        const walk = async (dir: string) => {
          const items = await sftpReaddir(sftp, dir);
          for (const item of items) {
            if (item.filename === "." || item.filename === "..") continue;
            const fullPath = `${dir}/${item.filename}`;
            const isDir = (item.attrs.mode & 0o40000) !== 0;
            if (isDir) {
              await walk(fullPath);
            } else {
              results.push({
                path: fullPath,
                size: item.attrs.size ?? 0,
                modifiedAt: new Date(
                  (item.attrs.mtime ?? 0) * 1000,
                ).toISOString(),
              });
            }
          }
        };
        await walk(remotePath);
      }),
    );

    return results;
  }

  async readRange(
    target: SshTarget,
    inputPath: string,
    offset: number,
    length: number,
  ): Promise<SftpReadRange> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_SFTP_READ_RANGE_BYTES
    ) {
      throw new Error("Invalid remote file read range");
    }

    const remotePath = await this.resolveRemotePath(target, inputPath);
    return this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        return readSftpRange(sftp, remotePath, offset, length);
      }),
    );
  }

  async readRanges(
    target: SshTarget,
    requests: Array<{ path: string; offset: number; length: number }>,
  ): Promise<SftpReadRange[]> {
    for (const request of requests) {
      if (
        !Number.isSafeInteger(request.offset) ||
        request.offset < 0 ||
        !Number.isSafeInteger(request.length) ||
        request.length < 0 ||
        request.length > MAX_SFTP_READ_RANGE_BYTES
      ) {
        throw new Error("Invalid remote file read range");
      }
    }

    const remotePaths = await Promise.all(
      requests.map((request) => this.resolveRemotePath(target, request.path)),
    );
    return this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        const results: SftpReadRange[] = [];
        for (const [index, request] of requests.entries()) {
          results.push(
            await readSftpRange(
              sftp,
              remotePaths[index]!,
              request.offset,
              request.length,
            ),
          );
        }
        return results;
      }),
    );
  }

  async rename(
    target: SshTarget,
    fromPath: string,
    toPath: string,
  ): Promise<string> {
    const resolvedFromPath = await this.resolveRemotePath(target, fromPath);
    const resolvedToPath = await this.resolveRemotePath(target, toPath);

    await this.withConnection(target, async (client) =>
      withSftp(client, (sftp) =>
        sftpRename(sftp, resolvedFromPath, resolvedToPath),
      ),
    );

    return resolvedToPath;
  }

  async remove(target: SshTarget, inputPath: string): Promise<void> {
    const remotePath = await this.resolveRemotePath(target, inputPath);

    await this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        await this.removePathRecursive(sftp, remotePath);
      }),
    );
  }

  async preview(
    target: SshTarget,
    inputPath: string,
    maxBytes?: number,
    offset?: number,
  ): Promise<FilePreviewResponse> {
    const remotePath = await this.resolveRemotePath(target, inputPath);

    return this.withConnection(target, async (client) =>
      withSftp(client, async (sftp) => {
        const fileStats = await sftpStat(sftp, remotePath);
        const fileSize = fileStats.size ?? 0;
        const window = normalizeFilePreviewWindow(fileSize, maxBytes, offset);
        const chunks: Buffer[] = [];
        const buffer =
          window.readBytes === 0
            ? Buffer.alloc(0)
            : await new Promise<Buffer>((resolve, reject) => {
                const stream = sftp.createReadStream(remotePath, {
                  start: window.offset,
                  end: window.offset + window.readBytes - 1,
                });
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("error", reject);
                stream.on("end", () => resolve(Buffer.concat(chunks)));
              });

        return buildFilePreviewResponse({
          path: remotePath,
          buffer,
          fileSize,
          offset: window.offset,
          maxBytes: window.maxBytes,
        });
      }),
    );
  }

  async chmod(
    target: SshTarget,
    inputPath: string,
    mode: string,
  ): Promise<void> {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    const parsedMode = validateChmodMode(mode);

    await this.withConnection(target, async (client) =>
      withSftp(client, (sftp) => sftpChmod(sftp, remotePath, parsedMode)),
    );
  }

  async createReadStream(target: SshTarget, inputPath: string) {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    const client = await this.getClient(target);
    this.touchConnection(target);
    const sftp = await openSftp(client);
    const stream = sftp.createReadStream(remotePath);
    const closeSftp = () => sftp.end();
    stream.once("close", closeSftp);
    stream.once("end", closeSftp);
    stream.once("error", closeSftp);
    return stream;
  }

  async createWriteStream(target: SshTarget, inputPath: string) {
    const remotePath = await this.resolveRemotePath(target, inputPath);
    const client = await this.getClient(target);
    this.touchConnection(target);
    const sftp = await openSftp(client);
    const stream = sftp.createWriteStream(remotePath);
    const closeSftp = () => sftp.end();
    stream.once("close", closeSftp);
    stream.once("finish", closeSftp);
    stream.once("error", closeSftp);
    return stream;
  }

  async resolveRemotePath(
    target: SshTarget,
    inputPath: string,
  ): Promise<string> {
    assertSafeFilesystemPath(inputPath);

    if (inputPath.startsWith("/")) {
      return inputPath;
    }

    if (!inputPath.startsWith("~")) {
      return inputPath;
    }

    const connection = await this.getConnection(target);
    const homePath = await connection.homePath;
    const suffix = inputPath === "~" ? "" : inputPath.replace(/^~\/?/, "");
    return suffix ? joinRemotePath(homePath, suffix) : homePath;
  }

  private async removePathRecursive(
    sftp: SFTPWrapper,
    remotePath: string,
  ): Promise<void> {
    const stats = await sftpStat(sftp, remotePath);
    const type = detectFileEntryType(stats.mode ?? 0);

    if (type !== "directory") {
      await sftpUnlink(sftp, remotePath);
      return;
    }

    const children = await sftpReaddir(sftp, remotePath);
    for (const child of children) {
      await this.removePathRecursive(
        sftp,
        joinRemotePath(remotePath, child.filename),
      );
    }

    await sftpRmdir(sftp, remotePath);
  }

  private async withConnection<T>(
    target: SshTarget,
    callback: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await this.getClient(target);
    this.touchConnection(target);

    try {
      return await callback(client);
    } catch (error) {
      this.disposeConnection(target);
      throw error;
    }
  }

  private async getClient(target: SshTarget): Promise<Client> {
    const connection = await this.getConnection(target);
    this.touchConnection(target);
    return connection.client;
  }

  private async getConnection(target: SshTarget): Promise<PooledConnection> {
    const connectionKey = createConnectionKey(target);
    const existing = this.connections.get(connectionKey);
    if (existing) {
      await existing.ready;
      return existing;
    }

    const client = this.clientFactory();
    const connection = {
      client,
      homePath: Promise.resolve(""),
      idleTimer: null,
      ready: Promise.resolve(),
    } satisfies PooledConnection;

    connection.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SFTP connection timed out"));
      }, 30_000);

      client
        .once("ready", () => {
          clearTimeout(timeout);
          resolve();
        })
        .once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        })
        .once("close", () => {
          this.disposeConnection(target);
        })
        .connect({
          host: target.host,
          port: target.port ?? 22,
          username: target.username,
          ...resolveSftpAuthenticationOptions(target),
        });
    });
    this.connections.set(connectionKey, connection);

    try {
      await connection.ready;
    } catch (error) {
      this.connections.delete(connectionKey);
      throw error;
    }

    connection.homePath = withSftp(
      client,
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.realpath(".", (error, resolvedPath) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(resolvedPath);
          });
        }),
    );
    this.touchConnection(target);
    return connection;
  }

  private touchConnection(target: SshTarget): void {
    const connection = this.connections.get(createConnectionKey(target));
    if (!connection) {
      return;
    }

    if (connection.idleTimer) {
      clearTimeout(connection.idleTimer);
    }

    connection.idleTimer = setTimeout(() => {
      this.disposeConnection(target);
    }, this.idleTimeoutMs);
    // unref(): the pooled SFTP idle-timeout must not keep the Node event
    // loop alive independently of the Fastify server. Otherwise a single
    // pooled connection leaks into `node --test` runs and blocks process
    // exit after all tests have completed. See memories/repo/e2e.md.
    connection.idleTimer.unref();
  }

  private disposeConnection(target: SshTarget): void {
    const connectionKey = createConnectionKey(target);
    const connection = this.connections.get(connectionKey);
    if (!connection) {
      return;
    }

    if (connection.idleTimer) {
      clearTimeout(connection.idleTimer);
    }

    connection.client.end();
    this.connections.delete(connectionKey);
  }
}
