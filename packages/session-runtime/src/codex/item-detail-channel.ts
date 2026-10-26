import type { FastifyInstance } from "fastify";
import type { CodexOptions } from "./client.js";
import { HttpError } from "../core/json.js";
import { readItemDetail } from "./item-detail.js";
import { detailRequest } from "./item-detail-selector.js";
import { resolveCodexEnv } from "./providers.js";

/** Both hosts use the same isolated reader; neither needs a shared Agent RPC. */
export function registerItemDetailChannel(
  app: FastifyInstance,
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  path = "/api/codex/thread/item-detail",
) {
  const reads = new Map<AbortController, Promise<void>>();
  app.addHook("preClose", async () => {
    for (const controller of reads.keys()) controller.abort();
    await Promise.all(reads.values());
  });
  app.post(
    path,
    {
      bodyLimit: 16384,
      errorHandler: (error, _request, reply) => {
        if (reply.raw.headersSent) {
          reply.raw.destroy();
          return;
        }
        const status =
          error instanceof HttpError
            ? error.statusCode
            : [400, 413].includes(
                  Number((error as { statusCode?: number }).statusCode),
                )
              ? 400
              : 502;
        return reply
          .code(status)
          .header("cache-control", "no-store")
          .send({
            error:
              error instanceof HttpError
                ? error.message
                : status === 400
                  ? "DETAIL_INVALID_REQUEST"
                  : "DETAIL_PROTOCOL_ERROR",
          });
      },
    },
    async (request, reply) => {
      reply
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
      if (request.raw.url?.includes("?"))
        return reply.code(400).send({ error: "DETAIL_INVALID_REQUEST" });
      const wanted = detailRequest(request.body);
      const controller = new AbortController();
      const abort = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      const clean = () => {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abort);
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      const started = readItemDetail(options, wanted, controller.signal);
      const settled = started.then(
        (reading) => reading.finished,
        () => {},
      );
      reads.set(controller, settled);
      void settled.finally(() => {
        reads.delete(controller);
        clean();
      });
      try {
        const reading = await started;
        return reply.type("application/json").send(reading.body);
      } catch (error) {
        clean();
        if (error instanceof HttpError)
          return reply.code(error.statusCode).send({ error: error.message });
        return reply.code(502).send({ error: "DETAIL_PROTOCOL_ERROR" });
      }
    },
  );
}

/** Resolve the same provider environment as the session runtime, without creating its services. */
export function registerLocalItemDetailChannel(
  app: FastifyInstance,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  registerItemDetailChannel(
    app,
    { env, resolveEnv: () => resolveCodexEnv(dataDir, env) },
    "/api/session/api/codex/thread/item-detail",
  );
}

export { registerChatHistoryChannel, registerLocalChatHistoryChannel } from "./chat-history-channel.js";
