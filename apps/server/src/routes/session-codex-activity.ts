import type { FastifyInstance } from "fastify";

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;
const flags = new Set(["waitingOnApproval", "waitingOnUserInput"]);
const threadStates = new Set(["idle", "notLoaded", "systemError", "active"]);
const turnStates = new Set([
  "inProgress",
  "completed",
  "interrupted",
  "failed",
]);

export interface SessionCodexActivity {
  threadId: string;
  status: {
    type: "idle" | "notLoaded" | "systemError" | "active";
    activeFlags?: string[];
  };
  turn: {
    id: string;
    status: "inProgress" | "completed" | "interrupted" | "failed";
    startedAt: number | null;
    completedAt?: number | null;
    durationMs?: number | null;
  } | null;
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[-a-zA-Z0-9_:]{1,160}$/.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}
function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unavailable(): Error {
  return Object.assign(new Error("无法确认会话当前执行状态，请稍后重试。"), {
    statusCode: 503,
  });
}
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw unavailable();
}
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(unavailable());
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}
async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<any> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  let complete = false;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(signal);
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES
    )
      throw unavailable();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await cancellable(reader.read(), signal);
      checkAbort(signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      length += part.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw unavailable();
      chunks.push(part.value);
    }
    complete = true;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
function timestamp(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      Number.isFinite(value * 1000))
  );
}

/** Reads execution facts from the current writer connection, never an independent history reader. */
export async function readSessionCodexActivity(
  origin: string,
  fetcher: typeof fetch,
  threadId: string,
  signal?: AbortSignal,
): Promise<SessionCodexActivity> {
  if (!validId(threadId)) throw unavailable();
  let address: URL;
  try {
    address = new URL(origin);
  } catch {
    throw unavailable();
  }
  if (
    address.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(address.hostname) ||
    address.pathname !== "/" ||
    address.search ||
    address.hash ||
    address.username ||
    address.password
  )
    throw unavailable();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, TIMEOUT_MS);
  timer.unref();
  const current = controller.signal;
  const read = async (path: string, body: Record<string, unknown>) => {
    checkAbort(current);
    const pending = fetcher(`${address.origin}/api/codex/thread/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: current,
    });
    // A non-conforming fetch adapter may resolve after cancellation.
    void pending.then(
      (response) => {
        if (current.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    return boundedJson(await cancellable(pending, current), current);
  };
  try {
    const metadata = await read("metadata", { threadId });
    const thread = metadata?.thread;
    if (
      !object(thread) ||
      thread.id !== threadId ||
      !object(thread.status) ||
      !threadStates.has(thread.status.type)
    )
      throw unavailable();
    const status: SessionCodexActivity["status"] = { type: thread.status.type };
    if (thread.status.type === "active") {
      const activeFlags = thread.status.activeFlags;
      if (
        !Array.isArray(activeFlags) ||
        activeFlags.length > 2 ||
        activeFlags.some((flag) => !flags.has(flag))
      )
        throw unavailable();
      status.activeFlags = [...activeFlags];
    }
    const page = await read("turns/list", {
      threadId,
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    if (
      !object(page) ||
      (page.threadId !== undefined && page.threadId !== threadId) ||
      !Array.isArray(page.data) ||
      page.data.length > 1
    )
      throw unavailable();
    const native = page.data[0];
    let turn: SessionCodexActivity["turn"] = null;
    if (native !== undefined) {
      if (
        !object(native) ||
        !validId(native.id) ||
        !turnStates.has(native.status) ||
        (native.threadId !== undefined && native.threadId !== threadId) ||
        !timestamp(native.startedAt)
      )
        throw unavailable();
      turn = {
        id: native.id,
        status: native.status,
        startedAt: native.startedAt,
      };
      for (const field of ["completedAt", "durationMs"] as const) {
        if (native[field] === undefined) continue;
        if (!timestamp(native[field])) throw unavailable();
        turn[field] = native[field];
      }
    }
    checkAbort(current);
    return { threadId, status, turn };
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function registerSessionCodexActivityRoutes(
  app: FastifyInstance,
  options: {
    origin: () => string | null;
    fetch: typeof fetch;
  },
) {
  app.post(
    "/api/session/codex/activity",
    { bodyLimit: 1024 },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const body = request.body;
      if (
        !object(body) ||
        Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, "threadId") ||
        !validId(body.threadId) ||
        Object.keys(request.query as object).length
      )
        return reply.code(400).send({ error: "无效的会话活动查询" });
      const origin = options.origin();
      if (!origin)
        return reply.code(503).send({ error: unavailable().message });
      const controller = new AbortController();
      const abort = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      try {
        const activity = await readSessionCodexActivity(
          origin,
          options.fetch,
          body.threadId,
          controller.signal,
        );
        return reply.header("cache-control", "no-store").send(activity);
      } catch {
        return reply.code(503).send({ error: unavailable().message });
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abort);
      }
    },
  );
}
