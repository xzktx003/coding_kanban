import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CodexOptions } from "./client.js";
import { HttpError } from "../core/json.js";
import { ChatHistorySelector, chatHistoryRequest } from "./chat-history.js";
import { readNativeProjection, type DetailRead } from "./item-detail.js";
import { resolveCodexEnv } from "./providers.js";

type Fallback = (request: FastifyRequest, reply: FastifyReply) => unknown;
export function registerChatHistoryChannel(
  app: FastifyInstance,
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  path = "/api/codex/thread/turns/list",
  fallback?: Fallback,
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
          const reading = await readNativeProjection(
            options,
            {
              channel: "chat",
              method: "thread/turns/list",
              params,
              selector: (initialized, ready) =>
                new ChatHistorySelector(initialized, ready),
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
  fallback: Fallback,
  env: NodeJS.ProcessEnv = process.env,
) {
  registerChatHistoryChannel(
    app,
    { env, resolveEnv: () => resolveCodexEnv(dataDir, env) },
    "/api/session/api/codex/thread/turns/list",
    fallback,
  );
}
