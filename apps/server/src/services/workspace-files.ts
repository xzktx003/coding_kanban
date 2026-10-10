import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as archiverModule from "archiver";
import type archiver from "archiver";
import { Readable } from "node:stream";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export class WorkspaceFileError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const MAX_TEXT = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_DEPTH = 64;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, path: string) =>
  path === root || path.startsWith(root + sep);
type ZipArchiveConstructor = new (
  options?: archiver.ArchiverOptions,
) => archiver.Archiver;
const { ZipArchive } = archiverModule as unknown as {
  ZipArchive: ZipArchiveConstructor;
};
export interface TrashItem {
  id: string;
  root: string;
  path: string;
  name: string;
  deletedAt: string;
}
export interface WorkspaceDownload {
  path: string;
  filename: string;
  contentType: string;
  stream: NodeJS.ReadableStream & { destroy(error?: Error): void };
  close(): void;
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new WorkspaceFileError("下载已取消", 499);
}
export class WorkspaceFiles {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private trashHome: string,
    private roots: () => Promise<string[]>,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  private async target(
    root: string,
    input: string,
    exists = true,
    mutate = false,
  ) {
    if (
      typeof root !== "string" ||
      typeof input !== "string" ||
      !isAbsolute(root) ||
      /[\\\x00-\x1f]/.test(root + input) ||
      input.split("/").includes("..")
    )
      throw new WorkspaceFileError("无效文件路径");
    const canonical = await realpath(root);
    if (canonical === sep || !(await stat(canonical)).isDirectory())
      throw new WorkspaceFileError("请选择有效的项目目录");
    const allowed = await this.roots();
    let accepted = false;
    for (const item of allowed) {
      try {
        const r = await realpath(item);
        if (r !== sep && inside(r, canonical)) {
          accepted = true;
          break;
        }
      } catch {}
    }
    if (!accepted)
      throw new WorkspaceFileError("项目目录未注册，不能执行文件操作", 403);
    const path = isAbsolute(input) ? resolve(input) : resolve(canonical, input);
    if (!inside(canonical, path))
      throw new WorkspaceFileError("文件路径超出当前项目", 403);
    const parts = relative(canonical, path).split(sep).filter(Boolean);
    if (
      mutate &&
      (inside(path, resolve(this.trashHome)) ||
        inside(resolve(this.trashHome), path))
    )
      throw new WorkspaceFileError("不能修改应用回收站存储目录", 403);
    if (mutate && (parts.length === 0 || parts.includes(".git")))
      throw new WorkspaceFileError("不能修改项目根目录或 Git 元数据", 403);
    let cursor = canonical;
    for (let i = 0; i < parts.length; i++) {
      cursor = join(cursor, parts[i]);
      try {
        const s = await lstat(cursor);
        if (s.isSymbolicLink())
          throw new WorkspaceFileError("不能通过符号链接访问文件", 403);
        if (i < parts.length - 1 && !s.isDirectory())
          throw new WorkspaceFileError("父路径不是目录");
      } catch (e) {
        if (
          !exists &&
          i === parts.length - 1 &&
          (e as NodeJS.ErrnoException).code === "ENOENT"
        )
          break;
        throw e;
      }
    }
    return { root: canonical, path };
  }
  private async bytes(path: string, limit = MAX_TEXT) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await handle.stat();
      if (!s.isFile()) throw new WorkspaceFileError("请选择普通文件");
      if (s.size > limit)
        throw new WorkspaceFileError("文件过大，请下载或使用外部编辑器", 413);
      return { bytes: await handle.readFile(), mode: s.mode, nlink: s.nlink };
    } finally {
      await handle.close();
    }
  }
  async read(root: string, path: string, limit = MAX_TEXT) {
    const target = await this.target(root, path);
    const { bytes } = await this.bytes(target.path, limit);
    let content: string;
    try {
      if (bytes.includes(0)) throw new Error();
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      content = bytes.toString("utf8");
    } catch {
      throw new WorkspaceFileError(
        "文件不是 UTF-8 文本，请使用预览或下载",
        415,
      );
    }
    return {
      path: target.path,
      content,
      version: hash(bytes),
      size: bytes.length,
    };
  }
  async version(root: string, path: string) {
    const t = await this.target(root, path);
    const { bytes } = await this.bytes(t.path, 64 * 1024 * 1024);
    return { version: hash(bytes) };
  }
  private async put(
    root: string,
    path: string,
    bytes: Buffer,
    version: string | null,
  ) {
    if (version !== null && !/^[a-f0-9]{64}$/.test(version))
      throw new WorkspaceFileError("无效文件版本");
    const t = await this.target(root, path, false, true);
    let previous: Awaited<ReturnType<WorkspaceFiles["bytes"]>> | null = null;
    try {
      previous = await this.bytes(t.path, 64 * 1024 * 1024);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (previous && version === null)
      throw new WorkspaceFileError(
        "目标文件已存在，请选择跳过、改名或明确覆盖",
        409,
      );
    if (version !== null && (!previous || hash(previous.bytes) !== version))
      throw new WorkspaceFileError(
        "磁盘文件已更新，当前草稿已保留，请重新比较内容",
        409,
      );
    if (previous && previous.nlink > 1)
      throw new WorkspaceFileError("不能覆盖带有硬链接的文件", 403);
    const temp = join(dirname(t.path), `.kanban-write-${randomUUID()}`);
    try {
      await writeFile(temp, bytes, {
        flag: "wx",
        mode: previous ? previous.mode & 0o777 : 0o600,
      });
      await chmod(temp, previous ? previous.mode & 0o777 : 0o600);
      await this.target(root, path, false, true);
      if (version === null) {
        await link(temp, t.path);
        await rm(temp);
      } else {
        const now = await this.bytes(t.path, 64 * 1024 * 1024);
        if (hash(now.bytes) !== version)
          throw new WorkspaceFileError("磁盘文件已更新，当前草稿已保留", 409);
        await rename(temp, t.path);
      }
      return { path: t.path, version: hash(bytes) };
    } finally {
      await rm(temp, { force: true });
    }
  }
  save(root: string, path: string, content: string, version: string | null) {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_TEXT)
      return Promise.reject(new WorkspaceFileError("文本文件过大", 413));
    return this.serial(() =>
      this.put(root, path, Buffer.from(content), version),
    );
  }
  upload(root: string, path: string, bytes: Buffer, version: string | null) {
    if (bytes.length > 64 * 1024 * 1024)
      return Promise.reject(
        new WorkspaceFileError("上传文件过大（最多 64 MiB）", 413),
      );
    return this.serial(() => this.put(root, path, bytes, version));
  }
  create(root: string, path: string, kind: "file" | "directory") {
    return this.serial(async () => {
      if (kind !== "file" && kind !== "directory")
        throw new WorkspaceFileError("无效文件类型");
      if (kind === "file") return this.put(root, path, Buffer.alloc(0), null);
      const t = await this.target(root, path, false, true);
      try {
        await mkdir(t.path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          throw new WorkspaceFileError("目标已存在", 409);
        throw e;
      }
      return { path: t.path };
    });
  }
  move(root: string, path: string, destination: string) {
    return this.serial(async () => {
      const source = await this.target(root, path, true, true);
      const dest = await this.target(root, destination, false, true);
      if (inside(source.path, dest.path))
        throw new WorkspaceFileError("不能移动到自身或自身子目录");
      try {
        await lstat(dest.path);
        throw new WorkspaceFileError("目标已存在，不会覆盖", 409);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await rename(source.path, dest.path);
      return { path: dest.path };
    });
  }
  private async relocate(from: string, to: string) {
    try {
      await rename(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await cp(from, to, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
      await rm(from, { recursive: true });
    }
  }
  trash(root: string, path: string) {
    return this.serial(async () => {
      const source = await this.target(root, path, true, true);
      const id = randomUUID(),
        home = join(this.trashHome, id);
      await mkdir(home, { recursive: true, mode: 0o700 });
      const item: TrashItem = {
        id,
        root: source.root,
        path: source.path,
        name: basename(source.path),
        deletedAt: new Date().toISOString(),
      };
      await writeFile(join(home, "entry.json"), JSON.stringify(item), {
        flag: "wx",
        mode: 0o600,
      });
      try {
        await this.relocate(source.path, join(home, "data"));
      } catch (e) {
        await rm(home, { recursive: true, force: true });
        throw e;
      }
      return item;
    });
  }
  private async entry(root: string, id: string) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new WorkspaceFileError("无效回收站项");
    const item = JSON.parse(
      await readFile(join(this.trashHome, id, "entry.json"), "utf8"),
    ) as TrashItem;
    const canonical = await realpath(root);
    if (item.id !== id || item.root !== canonical)
      throw new WorkspaceFileError("回收站项不属于当前项目", 403);
    await this.target(root, root);
    return item;
  }
  async listTrash(root: string) {
    await this.target(root, root);
    let ids: string[] = [];
    try {
      const dir = await opendir(this.trashHome);
      try {
        for await (const entry of dir) ids.push(entry.name);
      } finally {
        await dir.close().catch(() => {});
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const result: TrashItem[] = [];
    for (const id of ids) {
      try {
        const item = await this.entry(root, id);
        await lstat(join(this.trashHome, id, "data"));
        result.push(item);
      } catch {}
    }
    return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  restore(root: string, id: string) {
    return this.serial(async () => {
      const item = await this.entry(root, id),
        dest = await this.target(root, item.path, false, true);
      try {
        await lstat(dest.path);
        throw new WorkspaceFileError(
          "原位置已存在文件，请先移动或改名，不会覆盖",
          409,
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.relocate(join(this.trashHome, id, "data"), dest.path);
      await rm(join(this.trashHome, id), { recursive: true });
      return { path: dest.path };
    });
  }
  purge(root: string, id: string) {
    return this.serial(async () => {
      await this.entry(root, id);
      await rm(join(this.trashHome, id), { recursive: true });
      return { ok: true };
    });
  }
  async download(root: string, path: string) {
    const t = await this.target(root, path);
    const handle = await open(
      t.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    if (!(await handle.stat()).isFile()) {
      await handle.close();
      throw new WorkspaceFileError("请选择文件下载");
    }
    return { path: t.path, stream: handle.createReadStream() };
  }
  async downloadInfo(root: string, path: string) {
    const t = await this.target(root, path);
    const s = await lstat(t.path);
    if (s.isSymbolicLink())
      throw new WorkspaceFileError("不能通过符号链接访问文件", 403);
    if (s.isFile()) return { path: t.path, filename: basename(t.path) };
    if (s.isDirectory())
      return { path: t.path, filename: `${basename(t.path)}.zip` };
    throw new WorkspaceFileError("只支持下载普通文件或文件夹", 415);
  }
  private async *zipEntries(
    requestRoot: string,
    root: string,
    dir: string,
    signal: AbortSignal | undefined,
    depth = 0,
  ): AsyncGenerator<{ path: string; name: string; mode: number }> {
    throwIfAborted(signal);
    if (depth > MAX_ZIP_DEPTH)
      throw new WorkspaceFileError("文件夹层级过深，无法打包下载", 413);
    await this.target(requestRoot, dir);
    const handle = await opendir(dir);
    try {
      for await (const entry of handle) {
        throwIfAborted(signal);
        const fullPath = join(dir, entry.name);
        const s = await lstat(fullPath);
        if (s.isSymbolicLink()) continue;
        const checked = await this.target(requestRoot, fullPath);
        const relativePath = relative(root, checked.path).split(sep).join("/");
        if (s.isDirectory()) {
          yield { path: checked.path, name: `${relativePath}/`, mode: s.mode };
          yield* this.zipEntries(
            requestRoot,
            root,
            checked.path,
            signal,
            depth + 1,
          );
          continue;
        }
        if (!s.isFile())
          throw new WorkspaceFileError("文件夹包含不能下载的特殊文件", 415);
        yield { path: checked.path, name: relativePath, mode: s.mode };
      }
    } finally {
      await handle.close().catch(() => {});
    }
  }
  private noFollowStream(
    root: string,
    path: string,
    active: Set<Readable>,
    onError: (error: Error) => void,
  ) {
    const source = Readable.from(
      (async function* (files: WorkspaceFiles) {
        const checked = await files.target(root, path);
        const handle = await open(
          checked.path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const s = await handle.stat();
          if (!s.isFile())
            throw new WorkspaceFileError("文件夹包含不能下载的特殊文件", 415);
          for await (const chunk of handle.createReadStream({
            autoClose: false,
          })) {
            yield chunk;
          }
        } finally {
          await handle.close().catch(() => {});
        }
      })(this),
    );
    active.add(source);
    source.once("close", () => active.delete(source));
    source.once("error", (error) => onError(error));
    return source;
  }
  async downloadArchive(
    root: string,
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkspaceDownload> {
    throwIfAborted(options.signal);
    const info = await this.downloadInfo(root, path);
    throwIfAborted(options.signal);
    const s = await lstat(info.path);
    if (s.isFile()) {
      const file = await this.download(root, path);
      return {
        ...file,
        filename: info.filename,
        contentType: "application/octet-stream",
        close: () => file.stream.destroy(),
      };
    }
    const archive = new ZipArchive({ zlib: { level: 5 } });
    const active = new Set<Readable>();
    archive.on("error", () => {});
    const cleanupActive = (error?: Error) => {
      for (const source of active) source.destroy(error);
      active.clear();
    };
    const fail = (error: Error) => {
      cleanupActive(error);
      archive.destroy(error);
    };
    const close = (error?: Error) => {
      cleanupActive(error);
      if (error) archive.destroy(error);
      else archive.abort();
    };
    archive.once("close", () => cleanupActive());
    let count = 0;
    try {
      for await (const entry of this.zipEntries(
        root,
        info.path,
        info.path,
        options.signal,
      )) {
        count += 1;
        if (count > MAX_ZIP_ENTRIES)
          throw new WorkspaceFileError("文件夹文件数量过多，无法打包下载", 413);
        if (entry.name.endsWith("/")) {
          archive.append(Buffer.alloc(0), {
            name: entry.name,
            mode: entry.mode & 0o777,
          });
          continue;
        }
        archive.append(this.noFollowStream(root, entry.path, active, fail), {
          name: entry.name,
          mode: entry.mode & 0o777,
        });
      }
    } catch (error) {
      close(error instanceof Error ? error : undefined);
      throw error;
    }
    archive.finalize().catch(() => {});
    return {
      path: info.path,
      filename: info.filename,
      contentType: "application/zip",
      stream: archive,
      close,
    };
  }
}
