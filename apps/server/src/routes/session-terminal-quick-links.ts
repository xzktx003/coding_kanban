import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { writeDurableJson } from "../services/durable-json.js";

const MAX_LINKS = 40;
function invalid(message = "无效的快捷链接"): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function normalize(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  if (typeof item.title !== "string" || typeof item.url !== "string") invalid();
  const url = new URL(item.url.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048)
    invalid("请输入不含账号密码的 HTTP 或 HTTPS 链接");
  const title = item.title.trim() || url.host;
  if (title.length > 80) invalid("链接名称最多 80 个字符");
  return { title, url: url.href };
}
function validate(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_LINKS) invalid();
  const result = value.map(normalize);
  if (new Set(result.map((item) => item.url)).size !== result.length) invalid("快捷链接不能重复");
  return result;
}
export function registerSessionTerminalQuickLinksRoutes(app: FastifyInstance, { attachmentRoot }: { attachmentRoot?: string }) {
  const file = attachmentRoot ? join(attachmentRoot, "..", "terminal-quick-links.json") : undefined;
  let state: ReturnType<typeof validate> | undefined;
  let serial: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>) => { const task = serial.then(work); serial = task.catch(() => {}); return task; };
  const load = async () => {
    if (!file) invalid("快捷链接存储不可用");
    if (state) return state;
    try { state = validate(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = []; }
    return state;
  };
  app.get("/api/session/terminal-quick-links", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return run(async () => [...(await load())]);
  });
  app.put("/api/session/terminal-quick-links", { bodyLimit: 128 * 1024 }, async (request, reply) => {
    const next = validate(request.body);
    reply.header("cache-control", "no-store");
    return run(async () => { await writeDurableJson(file!, next); state = next; return [...next]; });
  });
}
