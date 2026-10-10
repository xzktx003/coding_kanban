import { randomBytes, createHash } from "node:crypto";
import { readdir, stat, readFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve, extname } from "node:path";
import { JsonStore } from "../core/json-store.js";
import { HttpError, object, type JsonObject } from "../core/json.js";
import { absolutePath, cleanString, run } from "./common.js";
interface LocalFile {
  rel: string;
  path: string;
  size: number;
}
export async function collectPublishFiles(root: string): Promise<LocalFile[]> {
  const all: LocalFile[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name),
        rel = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, rel + "/");
      else if (entry.isFile() && !rel.endsWith(".map"))
        all.push({ rel, path, size: (await stat(path)).size });
    }
  }
  await walk(root, "");
  return all.sort((a, b) => a.rel.localeCompare(b.rel));
}
/** Build commands are user-authored shell programs, not interpolated fragments. */
function buildCommand(value: unknown) {
  const command = cleanString(value, "buildCommand", true);
  if (command.length > 16384)
    throw new HttpError(400, "Build command is too long");
  return command.trim();
}
export class Publisher {
  private token: JsonStore;
  private base: string;
  constructor(
    dataHome: string,
    private env: NodeJS.ProcessEnv,
    private progress: (payload: JsonObject) => void,
    private fetcher: typeof fetch = fetch,
  ) {
    this.token = new JsonStore(
      join(dataHome, ".codexia/productship.json"),
      () => ({}),
    );
    this.base = (
      env.PRODUCTSHIP_URL?.trim() || "https://productship.lol"
    ).replace(/\/+$/, "");
    const url = new URL(this.base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid PRODUCTSHIP_URL");
  }
  start() {
    const code = randomBytes(32).toString("hex");
    const digest = createHash("sha256")
      .update(code)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    return {
      code,
      confirmCode: digest.slice(0, 4) + "-" + digest.slice(4),
      url: `${this.base}/connect?code=${code}`,
    };
  }
  private async request(
    path: string,
    body: JsonObject | undefined,
    token?: string,
    timeout = 20000,
  ) {
    const response = await this.fetcher(this.base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    let data: JsonObject = {};
    try {
      data = object(await response.json());
    } catch {}
    return { response, data };
  }
  private error(status: number, data: JsonObject) {
    return new Error(
      typeof data.error === "string"
        ? data.error
        : `ProductShip request failed (${status})`,
    );
  }
  async poll(codeValue: unknown) {
    const code = cleanString(codeValue, "code");
    if (!/^[a-fA-F0-9]{64}$/.test(code))
      throw new HttpError(400, "Invalid connect code");
    const { response, data } = await this.request("/api/connect/poll", {
      code,
    });
    if (response.status === 202) return { approved: false };
    if (!response.ok) throw this.error(response.status, data);
    if (typeof data.token !== "string" || !data.token)
      throw new Error("Malformed connect response");
    await this.token.write({ token: data.token });
    return { approved: true };
  }
  async disconnect() {
    await this.token.write({});
    return { ok: true };
  }
  async whoami() {
    const token = (await this.token.read()).token;
    if (typeof token !== "string") return { account: null };
    const { response, data } = await this.request(
      "/api/games/whoami",
      undefined,
      token,
    );
    if (response.status === 401) {
      await this.disconnect();
      return { account: null };
    }
    if (!response.ok) throw this.error(response.status, data);
    return { account: data };
  }
  async publish(input: JsonObject) {
    const token = (await this.token.read()).token;
    if (typeof token !== "string" || !token)
      throw new Error("Not connected to ProductShip. Connect first.");
    const cwd = absolutePath(input.cwd, "cwd");
    if (!(await stat(cwd)).isDirectory())
      throw new HttpError(400, "cwd must be a directory");
    const outputDir = cleanString(input.outputDir, "outputDir");
    const slug = cleanString(input.slug, "slug");
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug))
      throw new HttpError(400, "Invalid slug");
    const title = cleanString(input.title, "title");
    const emit = (stage: string, message: string, done = 0, total = 0) =>
      this.progress({ slug, stage, message, done, total });
    if (input.buildCommand != null) {
      const command = buildCommand(input.buildCommand);
      if (command) {
        emit("build", `Running \`${command}\``);
        await run(
          process.platform === "win32" ? "cmd.exe" : "sh",
          process.platform === "win32" ? ["/C", command] : ["-c", command],
          { cwd, env: this.env, timeout: 600000, maxBytes: 16 * 1024 * 1024 },
        );
      }
    }
    emit("scan", "Collecting files");
    const root = resolve(cwd, outputDir);
    if (!(await stat(root)).isDirectory())
      throw new Error(`Output folder not found: ${root}`);
    const files = await collectPublishFiles(root);
    if (!files.some((f) => f.rel === "index.html"))
      throw new Error(`${root} has no index.html at its root`);
    const body: JsonObject = {
      slug,
      title,
      files: files.map((f) => ({ path: f.rel, size: f.size })),
    };
    for (const key of ["tagline", "description", "genre", "dimension"])
      if (input[key] != null && input[key] !== "")
        body[key] = cleanString(input[key], key);
    let cover: string | undefined;
    if (input.coverPath) {
      cover = absolutePath(input.coverPath, "coverPath");
      const meta = await stat(cover);
      if (!meta.isFile()) throw new HttpError(400, "Cover must be a file");
      const ext = extname(cover).slice(1).toLowerCase();
      if (!ext) throw new HttpError(400, "Cover needs a file extension");
      body.cover = { ext, size: meta.size };
    }
    const init = await this.request("/api/games/publish", body, token, 120000);
    if (!init.response.ok) throw this.error(init.response.status, init.data);
    if (
      !Number.isSafeInteger(init.data.version) ||
      !Array.isArray(init.data.uploads)
    )
      throw new Error("Malformed publish response");
    const byPath = new Map(files.map((f) => [f.rel, f]));
    const jobs = init.data.uploads.map((target) => {
      const item = object(target);
      const file = byPath.get(String(item.path));
      if (
        !file ||
        typeof item.url !== "string" ||
        typeof item.contentType !== "string"
      )
        throw new Error("Server asked for unknown or invalid file");
      return { path: file.path, url: item.url, contentType: item.contentType };
    });
    const total = jobs.length;
    let cursor = 0,
      done = 0;
    emit("upload", `Uploading ${total} files`, 0, total);
    const upload = async (target: {
      path: string;
      url: string;
      contentType: string;
    }) => {
      const url = new URL(target.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Invalid upload URL");
      const stream = createReadStream(target.path);
      try {
        const response = await this.fetcher(url, {
          method: "PUT",
          headers: { "content-type": target.contentType },
          body: stream as unknown as BodyInit,
          duplex: "half",
          signal: AbortSignal.timeout(600000),
        } as RequestInit);
        await response.body?.cancel();
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      } finally {
        stream.destroy();
      }
    };
    const workers = Array.from({ length: Math.min(6, total) }, async () => {
      while (cursor < total) {
        const target = jobs[cursor++];
        await upload(target);
        done++;
        emit("upload", `Uploaded ${done}/${total}`, done, total);
      }
    });
    const results = await Promise.allSettled(workers);
    const failed = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failed) throw failed.reason;
    if (cover && init.data.cover) {
      const target = object(init.data.cover);
      if (
        typeof target.url !== "string" ||
        typeof target.contentType !== "string"
      )
        throw new Error("Invalid cover upload target");
      await upload({
        path: cover,
        url: target.url,
        contentType: target.contentType,
      });
    }
    emit("finalize", "Going live", total, total);
    const complete = await this.request(
      "/api/games/publish/complete",
      { slug, version: init.data.version },
      token,
      120000,
    );
    if (!complete.response.ok)
      throw this.error(complete.response.status, complete.data);
    if (
      !Number.isSafeInteger(complete.data.version) ||
      typeof complete.data.playUrl !== "string" ||
      typeof complete.data.pageUrl !== "string"
    )
      throw new Error("Malformed complete response");
    return {
      version: complete.data.version,
      playUrl: complete.data.playUrl,
      pageUrl: complete.data.pageUrl,
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    };
  }
}
