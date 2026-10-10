import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CodexHostOwner } from "@agent-orchestrator/shared";

const reject = (message: string, statusCode = 409): never => {
  throw Object.assign(new Error(message), { statusCode });
};
async function directory(value: unknown): Promise<string> {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) reject("原会话项目路径无法核验");
  const canonical = await realpath(value as string).catch(() => reject("原会话项目无法核验"));
  if (!(await stat(canonical)).isDirectory()) reject("原会话项目不是目录");
  return canonical;
}
function validateDraft(owner: CodexHostOwner): string | null {
  let key: unknown;
  try { key = JSON.parse(owner.draftOwner); } catch { reject("原会话草稿身份无效", 400); }
  if (!Array.isArray(key) || key.length !== 4 || key[0] !== "codex" || key[1] !== (owner.agentId ?? "") || key[2] !== (owner.threadId ? "session" : "new") || typeof key[3] !== "string" || (owner.threadId && key[3] !== owner.threadId)) return reject("原会话草稿身份不匹配", 400);
  return owner.threadId ? null : key[3];
}
export interface CodexHostNativeThread {
  id: string;
  cwd: string;
  turns?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
/** Host and cloud actions may inspect native history, never resume or acquire a writer. */
export function createCodexHostOwnerResolver(options: {
  origin: () => string | null;
  projects: () => Promise<string[]>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const readNative = async (threadId: string, metadata: boolean): Promise<CodexHostNativeThread> => {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(threadId)) reject("原会话身份无效", 400);
    const origin = options.origin();
    if (!origin) reject("会话运行服务尚未连接，无法核验原会话", 503);
    const response = await fetcher(origin + (metadata ? "/api/codex/thread/metadata" : "/api/codex/thread/read"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }), signal: AbortSignal.timeout(15000),
    }).catch(() => reject("无法只读核验原会话", 503));
    if (metadata && [404, 405, 501].includes(response.status)) return readNative(threadId, false);
    if (!response.ok) reject("无法只读核验原会话", response.status === 404 ? 409 : 503);
    const data = await response.json().catch(() => reject("原会话核验结果无效")) as { thread?: CodexHostNativeThread };
    if (!data.thread || data.thread.id !== threadId) return reject("原会话身份不匹配");
    return data.thread;
  };
  const readThread = (threadId: string) => readNative(threadId, false);
  const resolve = async (owner: CodexHostOwner): Promise<string> => {
    const draftCwd = validateDraft(owner);
    const cwd = await directory(owner.cwd);
    if (owner.threadId) {
      const thread = await readNative(owner.threadId, true);
      if (await directory(thread.cwd) !== cwd) reject("原生会话与捕获的项目不一致");
    } else {
      if (await directory(draftCwd) !== cwd) reject("原会话草稿项目身份不匹配", 400);
      const registered = await Promise.all((await options.projects()).map((path) => directory(path).catch(() => null)));
      if (!registered.includes(cwd)) reject("新会话项目未注册，未开放宿主操作");
    }
    return cwd;
  };
  return { resolve, readThread };
}
