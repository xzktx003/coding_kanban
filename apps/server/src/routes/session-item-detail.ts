import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";

/** Fixed selected-item channel. Lifetime includes waiting for headers and streaming the final tail. */
export function registerSessionItemDetail(
  app: FastifyInstance,
  origin: () => string | null,
  fetchUpstream: typeof fetch,
) {
  app.post(
    "/api/session/api/codex/thread/item-detail",
    {
      bodyLimit: 16384,
      errorHandler: (error, _request, reply) => {
        if (reply.raw.headersSent) {
          reply.raw.destroy();
          return;
        }
        const status = [400, 413].includes(
          Number((error as { statusCode?: number }).statusCode),
        )
          ? 400
          : 502;
        return reply
          .code(status)
          .header("cache-control", "no-store")
          .send({
            error:
              status === 400
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
      const upstream = origin();
      if (!upstream)
        return reply.code(503).send({ error: "DETAIL_UNAVAILABLE" });
      const controller = new AbortController();
      const abort = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      const timer = setTimeout(() => controller.abort(), 120000);
      const clean = () => {
        clearTimeout(timer);
        request.raw.off("aborted", abort);
        reply.raw.off("close", abort);
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      reply.raw.once("finish", clean);
      reply.raw.once("close", clean);
      try {
        const response = await fetchUpstream(
          upstream + "/api/codex/thread/item-detail",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request.body ?? {}),
            signal: controller.signal,
            redirect: "manual",
          },
        );
        reply.code(response.status);
        for (const name of [
          "content-type",
          "cache-control",
          "x-content-type-options",
        ]) {
          const value = response.headers.get(name);
          if (value) reply.header(name, value);
        }
        reply.header("cache-control", "no-store");
        if (!response.body) {
          clean();
          return reply.send();
        }
        const stream = Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
          { highWaterMark: 65536 },
        );
        stream.once("error", () => controller.abort());
        return reply.send(stream);
      } catch {
        clean();
        if (reply.raw.destroyed) return reply;
        return reply
          .code(controller.signal.aborted ? 504 : 503)
          .send({
            error: controller.signal.aborted
              ? "DETAIL_TIMEOUT"
              : "DETAIL_UNAVAILABLE",
          });
      }
    },
  );
}
