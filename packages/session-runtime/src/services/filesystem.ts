import {
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { bodyObject, HttpError, stringField } from "../core/json.js";
import type { FileWatches } from "./file-watches.js";
import { absolutePath } from "./paths.js";
import { searchFiles } from "./file-search.js";

const textExtensions = new Set([
  "txt",
  "md",
  "json",
  "xml",
  "yaml",
  "yml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "rs",
  "py",
  "java",
  "cpp",
  "c",
  "h",
  "css",
  "html",
  "toml",
  "cfg",
  "ini",
  "sh",
  "log",
]);
const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};
export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  extension: string | null;
}

export async function fileEntry(
  path: string,
  name: string,
): Promise<FileEntry> {
  const info = await stat(path).catch(() => undefined);
  const directory = info?.isDirectory() ?? false;
  return {
    name,
    path,
    is_dir: directory,
    size: directory ? null : (info?.size ?? null),
    extension: directory ? null : extname(path).slice(1) || null,
  };
}

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error("File does not exist or is a directory");
    if (info.size > limit) throw new Error("File is too large to read");
    // The file may grow after stat. Read at most limit + 1 bytes from the same handle.
    const chunks: Buffer[] = [];
    let size = 0;
    while (size <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
    if (size > limit) throw new Error("File is too large to read");
    return Buffer.concat(chunks, size);
  } finally {
    await file.close();
  }
}

export function registerFilesystemRoutes(
  app: FastifyInstance,
  watches: FileWatches,
  env: NodeJS.ProcessEnv,
): void {
  const post = (
    route: string,
    handler: (body: ReturnType<typeof bodyObject>) => Promise<unknown>,
  ) => {
    app.post(`/api/filesystem/${route}`, async (request, reply) => {
      const result = await handler(bodyObject(request.body));
      // Fastify treats raw strings as text; legacy Axum Json<String> is a JSON scalar.
      if (typeof result === "string")
        return reply.type("application/json").send(JSON.stringify(result));
      return result === undefined ? reply.code(200).send() : result;
    });
  };
  app.get("/api/filesystem/home-directory", (_request, reply) =>
    reply.type("application/json").send(JSON.stringify(homedir())),
  );
  app.get("/api/filesystem/codex-home", (_request, reply) =>
    reply
      .type("application/json")
      .send(
        JSON.stringify(
          absolutePath(env.CODEX_HOME || join(homedir(), ".codex")),
        ),
      ),
  );
  post("canonicalize-path", async (body) => {
    const path = absolutePath(body.path);
    return realpath(path).catch(() => path);
  });
  post("read-directory", async (body) => {
    const path = absolutePath(body.path);
    const entries = await readdir(path, { withFileTypes: true });
    const results: FileEntry[] = [];
    // Bounded fan-out avoids opening thousands of metadata requests at once.
    for (let offset = 0; offset < entries.length; offset += 32) {
      results.push(
        ...(await Promise.all(
          entries
            .slice(offset, offset + 32)
            .map((entry) => fileEntry(join(path, entry.name), entry.name)),
        )),
      );
    }
    return results.sort(
      (a, b) =>
        Number(b.is_dir) - Number(a.is_dir) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  });
  post("read-text-file", async (body) =>
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readBounded(absolutePath(body.filePath), 1024 * 1024),
    ),
  );
  post("read-text-file-lines", async (body) => {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBounded(absolutePath(body.filePath), 5 * 1024 * 1024),
    );
    if (!text) return [];
    const lines = text.split("\n");
    // Rust BufRead::lines removes CR only as part of CRLF, not a bare final CR.
    const terminatedLines = lines.length - 1;
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line, index) =>
      index < terminatedLines && line.endsWith("\r") ? line.slice(0, -1) : line,
    );
  });
  post("read-file", async (body) =>
    (await readBounded(absolutePath(body.filePath), 50 * 1024 * 1024)).toString(
      "base64",
    ),
  );
  post("write-file", async (body) => {
    const path = absolutePath(body.filePath);
    if (typeof body.content !== "string")
      throw new HttpError(400, "Invalid content");
    if (!textExtensions.has(extname(path).slice(1).toLowerCase()))
      throw new Error("Only text files can be edited");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body.content);
  });
  post("delete-file", async (body) => {
    const path = absolutePath(body.filePath);
    if (!(await stat(path)).isFile())
      throw new Error("Cannot delete a directory");
    await unlink(path);
  });
  post("watch", async (body) => watches.watch(stringField(body, "path")));
  post("unwatch", async (body) => watches.unwatch(stringField(body, "path")));
  for (const namesOnly of [false, true])
    post(namesOnly ? "search-files-by-name" : "search-files", (body) =>
      searchFiles({
        root: stringField(body, "root"),
        query: body.query as string,
        excludeFolders: (body.exclude_folders ??
          body.excludeFolders ??
          []) as string[],
        maxResults: (body.max_results ?? body.maxResults) as number | undefined,
        namesOnly,
        env,
      }),
    );
  app.get("/api/filesystem/asset", async (request, reply) => {
    const path = absolutePath((request.query as { path?: string }).path);
    if (!(await stat(path)).isFile()) throw new Error("File does not exist");
    // Streaming preserves large media support without retaining the entire asset in memory.
    const file = await open(path, "r");
    return reply
      .type(
        mimeTypes[extname(path).slice(1).toLowerCase()] ??
          "application/octet-stream",
      )
      .header("cache-control", "private, max-age=60")
      .send(file.createReadStream({ autoClose: true }));
  });
}
