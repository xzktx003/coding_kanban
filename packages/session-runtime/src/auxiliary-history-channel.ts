import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createAuxiliaryHistoryReader,
  type AuxiliaryHistoryReaderOptions,
  type AuxiliaryHistoryProvider,
} from "./auxiliary-history-reader.js";
import { bodyObject, HttpError, stringField } from "./core/json.js";
import {
  historyDetailOptions,
  recentHistoryOptions,
  RECENT_HISTORY_PAGE_BYTES,
} from "./core/recent-history.js";
import {
  historyImageHeaders,
  historyImageOptions,
} from "./core/history-image.js";

export {
  createAuxiliaryHistoryReader,
  readClaudeHistoryWorker,
} from "./auxiliary-history-reader.js";
export type {
  AuxiliaryHistoryReaderOptions,
  AuxiliaryHistoryProvider,
} from "./auxiliary-history-reader.js";
export {
  historyImageHeaders,
  historyImageOptions,
} from "./core/history-image.js";
export { historyDetailOptions } from "./core/recent-history.js";
export interface LocalAuxiliaryHistoryChannelOptions extends AuxiliaryHistoryReaderOptions {
  /** Raw history stays on the existing runtime protocol. */
  fallback: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

/** Optional fixed routes, or import the factory into an existing gateway handler. */
export function registerLocalAuxiliaryHistoryChannel(
  app: FastifyInstance,
  options: LocalAuxiliaryHistoryChannelOptions,
) {
  const reader = createAuxiliaryHistoryReader(options);
  for (const provider of ["cc", "acp"] as AuxiliaryHistoryProvider[]) {
    const paths =
      provider === "cc"
        ? [
            "/api/session/api/cc/session-messages",
            "/api/session/api/cc/session-message-detail",
            "/api/session/api/cc/session-message-image",
          ]
        : [
            "/api/session/api/acp/session",
            "/api/session/api/acp/session-detail",
            "/api/session/api/acp/session-image",
          ];
    for (const [kind, path] of paths.entries())
      app.post(path, { bodyLimit: 16 * 1024 }, async (request, reply) => {
        const url = new URL(request.raw.url!, "http://session.invalid");
        if (kind === 0 && !url.searchParams.has("view"))
          return options.fallback(request, reply);
        reply
          .header("cache-control", "no-store")
          .header("x-content-type-options", "nosniff");
        const controller = new AbortController();
        const abort = () => {
          if (!reply.raw.writableFinished) controller.abort();
        };
        request.raw.once("aborted", abort);
        reply.raw.once("close", abort);
        try {
          if (kind === 0 ? url.search !== "?view=recent" : !!url.search)
            throw new HttpError(400, "无效的历史读取方式。");
          const body = bodyObject(request.body),
            id = stringField(body, "session_id");
          const keys =
            kind === 0
              ? ["session_id", "cursor", "limit", "metadataOnly"]
              : kind === 1
                ? ["session_id", "item_id", "offset", "limit"]
                : ["session_id", "item_id", "image_index", "download"];
          if (Object.keys(body).some((key) => !keys.includes(key)))
            throw new HttpError(400, "历史读取不接受目录或运行配置。");
          if (kind === 0) {
            const page = await reader.readRecent(
              provider,
              id,
              recentHistoryOptions(body),
              controller.signal,
            );
            if (
              Buffer.byteLength(JSON.stringify(page)) >
              RECENT_HISTORY_PAGE_BYTES
            )
              throw new HttpError(413, "近期历史超过 2 MiB 预算。");
            return reply.send(page);
          }
          if (kind === 1) {
            const detail = historyDetailOptions(body);
            return reply.send(
              await reader.readDetail(
                provider,
                id,
                detail.itemId,
                detail,
                controller.signal,
              ),
            );
          }
          const image = historyImageOptions(body);
          const value = await reader.readImage(
            provider,
            id,
            image.itemId,
            image.index,
            image.download,
            controller.signal,
          );
          return reply
            .headers(historyImageHeaders(value, image.index, image.download))
            .send(value.bytes);
        } catch (error) {
          if (controller.signal.aborted || reply.raw.destroyed) return reply;
          return reply
            .code(error instanceof HttpError ? error.statusCode : 503)
            .send({
              error:
                error instanceof HttpError
                  ? error.message
                  : "本地只读历史暂不可用，请重试。",
            });
        } finally {
          request.raw.off("aborted", abort);
          reply.raw.off("close", abort);
        }
      });
  }
  return reader;
}
