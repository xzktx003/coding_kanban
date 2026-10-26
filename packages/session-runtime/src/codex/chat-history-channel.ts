import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CodexOptions } from "./client.js";
import { HttpError } from "../core/json.js";
import { ChatHistorySelector, chatHistoryRequest } from "./chat-history.js";
import { readNativeProjection } from "./item-detail.js";
import { resolveCodexEnv } from "./providers.js";

type Fallback = (request: FastifyRequest, reply: FastifyReply) => unknown;
export function registerChatHistoryChannel(
  app: FastifyInstance,
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  path = "/api/codex/thread/turns/list",
  fallback?: Fallback,
) {
  const reads = new Map<AbortController, Promise<unknown>>();
  let tail = Promise.resolve();
  app.addHook("preClose", async () => {
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
    const started = tail.then(() =>
      readNativeProjection(
        options,
        {
          channel: "chat",
          method: "thread/turns/list",
          params,
          selector: (initialized, ready) =>
            new ChatHistorySelector(initialized, ready),
        },
        controller.signal,
      ),
    );
    const settled = started.then(
      (reading) => reading.finished,
      () => {},
    );
    tail = settled;
    reads.set(controller, settled);
    void settled.finally(() => {
      clearTimeout(timer);
      reads.delete(controller);
      request.raw.off("aborted", abort);
      reply.raw.off("close", abort);
    });
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
