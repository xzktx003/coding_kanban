import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CodexOptions } from "./client.js";
import { HttpError } from "../core/json.js";
import {
  ChatHistorySelector,
  chatHistoryRequest,
  type CurrentChatTurn,
} from "./chat-history.js";
import { readNativeProjection, type DetailRead } from "./item-detail.js";
import { resolveCodexEnv } from "./providers.js";

type Fallback = (request: FastifyRequest, reply: FastifyReply) => unknown;
export type ReadCurrentChatTurn = (
  threadId: string,
  signal: AbortSignal,
) => Promise<CurrentChatTurn | null>;

async function currentExecution(
  read: ReadCurrentChatTurn | undefined,
  threadId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!read) return null;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new HttpError(502, "CHAT_HISTORY_CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const requested = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return read(threadId, signal);
    });
    const current = await Promise.race([requested, cancelled]);
    signal.throwIfAborted();
    if (current === null) return null;
    if (
      !current ||
      typeof current.id !== "string" ||
      !current.id ||
      current.id.length > 512 ||
      !["inProgress", "completed", "interrupted", "failed"].includes(
        current.status,
      ) ||
      [current.startedAt, current.completedAt, current.durationMs].some(
        (value) =>
          value !== undefined &&
          value !== null &&
          (typeof value !== "number" || !Number.isFinite(value) || value < 0),
      )
    )
      throw new HttpError(502, "CHAT_HISTORY_INVALID_EXECUTION_STATE");
    // Copy only bounded execution metadata, never retain an accidental item body.
    return {
      id: current.id,
      status: current.status,
      ...(current.startedAt === undefined
        ? {}
        : { startedAt: current.startedAt }),
      ...(current.completedAt === undefined
        ? {}
        : { completedAt: current.completedAt }),
      ...(current.durationMs === undefined
        ? {}
        : { durationMs: current.durationMs }),
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export function registerChatHistoryChannel(
  app: FastifyInstance,
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  path = "/api/codex/thread/turns/list",
  fallback?: Fallback,
  readCurrentTurn?: ReadCurrentChatTurn,
) {
  const reads = new Map<AbortController, Promise<unknown>>();
  const queue: Array<{ run: () => Promise<void> }> = [];
  let active = false;
  let closing = false;
  const pump = () => {
    if (active || closing) return;
    const job = queue.shift();
    if (!job) return;
    active = true;
    void job.run().finally(() => {
      active = false;
      pump();
    });
  };
  app.addHook("preClose", async () => {
    closing = true;
    for (const controller of reads.keys()) controller.abort();
    await Promise.allSettled(reads.values());
  });
  app.post(path, { bodyLimit: 16384 }, async (request, reply) => {
    const url = new URL(request.raw.url!, "http://localhost");
    if (url.searchParams.get("view") !== "chat") {
      if (fallback) return fallback(request, reply);
      return reply.code(400).send({ error: "CHAT_HISTORY_INVALID_VIEW" });
    }
    if (url.searchParams.size !== 1)
      return reply.code(400).send({ error: "CHAT_HISTORY_INVALID_VIEW" });
    if (
      request.body &&
      typeof request.body === "object" &&
      (request.body as { itemsView?: unknown }).itemsView === "notLoaded"
    ) {
      if (fallback) return fallback(request, reply);
      return reply.code(400).send({ error: "CHAT_HISTORY_INVALID_REQUEST" });
    }
    let params;
    try {
      params = chatHistoryRequest(request.body);
    } catch {
      return reply.code(400).send({ error: "CHAT_HISTORY_INVALID_REQUEST" });
    }
    // At most one independent chat reader plus sixteen small queued requests.
    // Admission never replaces an Agent or increases the shared RPC frame cap.
    if (reads.size >= 17)
      return reply.code(429).send({ error: "CHAT_HISTORY_BUSY" });
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    const timer = setTimeout(() => controller.abort(), 120_000);
    request.raw.once("aborted", abort);
    reply.raw.once("close", abort);
    let resolveStarted!: (value: DetailRead) => void;
    let rejectStarted!: (error: unknown) => void;
    let finish!: () => void;
    const started = new Promise<DetailRead>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job = {
      run: async () => {
        try {
          const currentTurn = await currentExecution(
            readCurrentTurn,
            params.threadId,
            controller.signal,
          );
          const reading = await readNativeProjection(
            options,
            {
              channel: "chat",
              method: "thread/turns/list",
              params,
              selector: (initialized, ready) =>
                new ChatHistorySelector(initialized, ready, currentTurn),
            },
            controller.signal,
          );
          resolveStarted(reading);
          // Admission stays occupied until the owned native process has exited.
          await reading.finished;
        } catch (error) {
          rejectStarted(error);
        } finally {
          finish();
        }
      },
    };
    const cancelQueued = () => {
      const index = queue.indexOf(job);
      if (index < 0) return; // Active readers own their cancellation/cleanup.
      queue.splice(index, 1);
      rejectStarted(new HttpError(502, "CHAT_HISTORY_CANCELLED"));
      finish();
    };
    controller.signal.addEventListener("abort", cancelQueued, { once: true });
    reads.set(controller, settled);
    void settled.then(() => {
      clearTimeout(timer);
      reads.delete(controller);
      controller.signal.removeEventListener("abort", cancelQueued);
      request.raw.off("aborted", abort);
      reply.raw.off("close", abort);
    });
    queue.push(job);
    pump();
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
    try {
      const reading = await started;
      return reply.type("application/json").send(reading.body);
    } catch (error) {
      return reply
        .code(error instanceof HttpError ? error.statusCode : 502)
        .send({
          error:
            error instanceof HttpError
              ? error.message.replace(/^DETAIL_/, "CHAT_HISTORY_")
              : "CHAT_HISTORY_PROTOCOL_ERROR",
        });
    }
  });
}
export function registerLocalChatHistoryChannel(
  app: FastifyInstance,
  dataDir: string,
  fallback?: Fallback,
  readCurrentTurnOrEnv?: ReadCurrentChatTurn | NodeJS.ProcessEnv,
  env: NodeJS.ProcessEnv = process.env,
) {
  const readCurrentTurn =
    typeof readCurrentTurnOrEnv === "function"
      ? readCurrentTurnOrEnv
      : undefined;
  const runtimeEnv =
    typeof readCurrentTurnOrEnv === "function"
      ? env
      : (readCurrentTurnOrEnv ?? env);
  registerChatHistoryChannel(
    app,
    { env: runtimeEnv, resolveEnv: () => resolveCodexEnv(dataDir, runtimeEnv) },
    "/api/session/api/codex/thread/turns/list",
    fallback,
    readCurrentTurn,
  );
}
