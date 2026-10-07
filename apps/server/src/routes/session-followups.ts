import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { FastifyInstance } from "fastify";
import type {
  FollowupAction,
  FollowupSubmit,
} from "@agent-orchestrator/shared";
import {
  CodexFollowups,
  FollowupRejected,
  type FollowupRuntime,
} from "../services/codex-followups.js";

function invalid(message = "无效的消息队列请求"): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalid();
  return v as Record<string, any>;
};
const keys = (v: Record<string, unknown>, names: string[]) => {
  if (Object.keys(v).some((k) => !names.includes(k))) invalid();
};
const id = (v: unknown): string => {
  if (typeof v !== "string" || !/^[-a-zA-Z0-9_:]{1,160}$/.test(v)) invalid();
  return v;
};
const message = (v: unknown): string => {
  if (typeof v !== "string" || v.length > 200_000 || v.includes("\0"))
    invalid();
  return v;
};
function submit(value: unknown): FollowupSubmit {
  const v = object(value);
  keys(v, [
    "id",
    "threadId",
    "text",
    "images",
    "parameters",
    "mode",
    "expectedTurnId",
  ]);
  id(v.id);
  id(v.threadId);
  message(v.text);
  if (!["queue", "steer", "replace"].includes(v.mode)) invalid();
  if (v.expectedTurnId !== undefined) id(v.expectedTurnId);
  if (
    !Array.isArray(v.images) ||
    v.images.length > 8 ||
    v.images.some(
      (p: unknown) =>
        typeof p !== "string" ||
        !p.startsWith("/") ||
        p.length > 4096 ||
        /[\x00-\x1f]/.test(p),
    )
  )
    invalid();
  if (!v.text.trim() && !v.images.length) invalid("消息不能为空");
  const p = object(v.parameters);
  keys(p, [
    "cwd",
    "model",
    "effort",
    "approvalPolicy",
    "sandboxPolicy",
    "collaborationMode",
  ]);
  if (JSON.stringify(p).length > 32000) invalid();
  for (const name of ["cwd", "model", "effort"])
    if (
      p[name] != null &&
      (typeof p[name] !== "string" ||
        p[name].length > 4096 ||
        /[\x00-\x1f]/.test(p[name]))
    )
      invalid();
  if (p.cwd != null && !p.cwd.startsWith("/")) invalid();
  if (
    p.approvalPolicy != null &&
    !["untrusted", "on-failure", "on-request", "never"].includes(
      p.approvalPolicy,
    )
  )
    invalid();
  if (p.sandboxPolicy != null) {
    const s = object(p.sandboxPolicy);
    keys(s, [
      "type",
      "networkAccess",
      "writableRoots",
      "excludeTmpdirEnvVar",
      "excludeSlashTmp",
    ]);
    if (
      ![
        "readOnly",
        "workspaceWrite",
        "dangerFullAccess",
        "externalSandbox",
      ].includes(s.type)
    )
      invalid();
    for (const k of ["networkAccess", "excludeTmpdirEnvVar", "excludeSlashTmp"])
      if (s[k] != null && typeof s[k] !== "boolean") invalid();
    if (
      s.writableRoots != null &&
      (!Array.isArray(s.writableRoots) ||
        s.writableRoots.some(
          (x: unknown) =>
            typeof x !== "string" ||
            !x.startsWith("/") ||
            /[\x00-\x1f]/.test(x),
        ))
    )
      invalid();
  }
  if (p.collaborationMode != null) {
    const c = object(p.collaborationMode);
    keys(c, ["mode", "settings"]);
    if (!["default", "plan"].includes(c.mode)) invalid();
    const s = object(c.settings);
    keys(s, ["model", "reasoning_effort", "developer_instructions"]);
    if (
      typeof s.model !== "string" ||
      s.model.length > 512 ||
      s.developer_instructions != null ||
      (s.reasoning_effort != null && typeof s.reasoning_effort !== "string")
    )
      invalid();
  }
  return v as FollowupSubmit;
}
function action(value: unknown): FollowupAction {
  const a = object(value);
  if (["clear", "pause", "resume"].includes(a.type)) {
    keys(a, ["type"]);
    return a as FollowupAction;
  }
  if (a.type === "reorder") {
    keys(a, ["type", "ids"]);
    if (!Array.isArray(a.ids) || a.ids.length > 100) invalid();
    a.ids.forEach(id);
    return a as FollowupAction;
  }
  if (a.type === "edit") {
    keys(a, ["type", "id", "text"]);
    id(a.id);
    message(a.text);
    return a as FollowupAction;
  }
  if (["delete", "retry", "steer"].includes(a.type)) {
    keys(a, ["type", "id", "expectedTurnId", "confirmUncertain"]);
    id(a.id);
    if (a.expectedTurnId !== undefined) id(a.expectedTurnId);
    if (
      a.confirmUncertain !== undefined &&
      typeof a.confirmUncertain !== "boolean"
    )
      invalid();
    return a as FollowupAction;
  }
  return invalid();
}

export function registerSessionFollowupRoutes(
  app: FastifyInstance,
  options: {
    file?: string;
    origin: () => string | null;
    fetch?: typeof fetch;
    runtime?: FollowupRuntime;
    autoStart?: boolean;
  },
) {
  const fetcher = options.fetch ?? fetch,
    lifetime = new AbortController();
  let lease: ChildProcess | undefined, init: Promise<void> | undefined;
  async function acquire() {
    if (!options.file) return;
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
    // Kernel lease is released even if the gateway is killed; no PID cleanup or process termination.
    await new Promise<void>((resolve, reject) => {
      lease = spawn(
        "flock",
        [
          "-n",
          "-E",
          "75",
          options.file + ".lock",
          process.execPath,
          "-e",
          "process.stdout.write('locked');process.stdin.resume()",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      lease.stdout!.once("data", () => resolve());
      lease.once("error", reject);
      lease.once("exit", () => reject(new Error("消息队列已由另一服务管理")));
    });
  }
  async function upstream(path: string, params?: unknown) {
    const origin = options.origin();
    if (!origin) throw new FollowupRejected("会话服务尚未连接");
    const response = await fetcher(origin + path, {
      method: params === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(params === undefined ? {} : { body: JSON.stringify(params) }),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) {
      let error = "请求失败";
      try {
        error = ((await response.json()) as any).error ?? error;
      } catch {}
      throw new FollowupRejected(error);
    }
    return response.json() as Promise<any>;
  }
  const runtime = options.runtime ?? {
    call: (method: string, params: Record<string, unknown>) =>
      upstream("/api/codex/" + method, params),
    statuses: async (ids: string[]) => {
      const remaining = new Set(ids),
        result: Record<string, string> = {};
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await upstream("/api/codex/thread/list", {
          limit: 100,
          cursor,
          modelProviders: null,
          cwd: null,
          useStateDbOnly: true,
          sortKey: "updated_at",
        });
        if (!Array.isArray(page.data)) throw new Error("无效的会话状态");
        for (const t of page.data)
          if (remaining.has(t.id)) {
            remaining.delete(t.id);
            result[t.id] = t.status?.type;
          }
        cursor = page.nextCursor ?? null;
        if (cursor && seen.has(cursor)) throw new Error("会话分页重复");
        if (cursor) seen.add(cursor);
      } while (cursor && remaining.size);
      return result;
    },
  };
  const queue = new CodexFollowups(runtime, options.file);
  const ready = () =>
    init ??
    (init = acquire().catch((e) => {
      init = undefined;
      throw e;
    }));
  app.get<{ Querystring: { threadId: string } }>(
    "/api/session/followups",
    async (request) => {
      const threadId = id(request.query.threadId);
      await ready();
      return queue.get(threadId);
    },
  );
  app.post(
    "/api/session/followups/submit",
    { bodyLimit: 1024 * 1024 },
    async (request) => {
      const data = submit(request.body);
      await ready();
      return queue.submit(data);
    },
  );
  app.post("/api/session/followups/change", async (request) => {
    const data = object(request.body);
    keys(data, ["threadId", "revision", "action"]);
    const threadId = id(data.threadId);
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) invalid();
    const op = action(data.action);
    await ready();
    return queue.change(threadId, data.revision, op);
  });
  app.post("/api/session/followups/stop", async (request) => {
    const data = object(request.body);
    keys(data, ["threadId", "turnId"]);
    const threadId = id(data.threadId),
      turnId = id(data.turnId);
    await ready();
    await queue.stop(threadId, turnId);
    return queue.get(threadId);
  });
  let timer: ReturnType<typeof setTimeout> | undefined,
    streamTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      await ready();
      await queue.tick();
    } catch (error) {
      app.log.warn({ err: error }, "Follow-up queue unavailable");
    } finally {
      if (!lifetime.signal.aborted) {
        timer = setTimeout(() => void poll(), 1000);
        timer.unref();
      }
    }
  };
  let sequence: number | undefined, instance: string | undefined;
  async function stream() {
    try {
      await ready();
      const origin = options.origin();
      if (!origin) throw new Error("Not ready");
      const health = await upstream("/health");
      if (health.instance !== instance) {
        sequence = undefined;
        instance = health.instance;
      }
      const response = await fetcher(
        origin +
          "/api/events" +
          (sequence === undefined ? "" : `?since=${sequence}`),
        { signal: lifetime.signal },
      );
      if (!response.ok || !response.body) throw new Error("Events unavailable");
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (
            typeof event.seq !== "number" ||
            (sequence !== undefined && event.seq <= sequence)
          )
            continue;
          sequence = event.seq;
          if (event.event === "codex:notification")
            void queue
              .observe(event.payload)
              .catch((error) =>
                app.log.error({ err: error }, "Follow-up event failed"),
              );
        }
        if (buffer.length > 8 * 1024 * 1024) throw new Error("Event too large");
      }
    } catch {
      /* Reconnect; durable sending records remain distinct from queued work. */
    } finally {
      if (!lifetime.signal.aborted) {
        streamTimer = setTimeout(() => void stream(), 1000);
        streamTimer.unref();
      }
    }
  }
  if (options.autoStart !== false)
    app.addHook("onReady", async () => {
      void poll();
      void stream();
    });
  app.addHook("onClose", async () => {
    lifetime.abort();
    clearTimeout(timer);
    clearTimeout(streamTimer);
    lease?.stdin?.end();
  });
  return queue;
}
