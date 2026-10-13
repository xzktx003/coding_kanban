import type { FastifyInstance } from "fastify";

import { TerminalHttpMultiplexer } from "../services/terminal-http-multiplexer.js";
import {
  isValidIdentifier,
  isValidSubscriptionId,
  normalizeReplayBytes,
} from "../services/terminal-http-multiplexer.js";

interface SubscribeTerminalStreamBody {
  agentSessionId?: unknown;
  subscriptionId?: unknown;
  replayBytes?: unknown;
}

export function registerTerminalHttpMultiplexerRoutes(
  fastify: FastifyInstance,
  multiplexer: TerminalHttpMultiplexer,
): void {
  fastify.get("/api/terminal-stream", (_request, reply) => {
    const response = reply.raw;
    reply.hijack();
    response.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    response.flushHeaders();
    multiplexer.createStream(response);
  });

  fastify.post<{
    Params: { streamId: string };
    Body: SubscribeTerminalStreamBody;
  }>("/api/terminal-stream/:streamId/subscriptions", async (request, reply) => {
    const { streamId } = request.params;
    if (!isValidIdentifier(streamId)) {
      reply.code(400);
      return { error: "终端流 ID 无效" };
    }

    const agentSessionId = request.body?.agentSessionId;
    if (!isValidIdentifier(agentSessionId)) {
      reply.code(400);
      return { error: "终端会话 ID 无效" };
    }

    const subscriptionId = request.body?.subscriptionId;
    if (!isValidSubscriptionId(subscriptionId)) {
      reply.code(400);
      return { error: "终端订阅 ID 无效" };
    }

    const requestedReplayBytes = request.body?.replayBytes;
    if (
      requestedReplayBytes !== undefined &&
      typeof requestedReplayBytes !== "number" &&
      typeof requestedReplayBytes !== "string"
    ) {
      reply.code(400);
      return {
        error: "终端回放窗口无效",
        code: "TERMINAL_REPLAY_BYTES_INVALID",
      };
    }

    const replayBytes = normalizeReplayBytes(requestedReplayBytes);
    if (replayBytes === null) {
      reply.code(400);
      return {
        error: "终端回放窗口无效",
        code: "TERMINAL_REPLAY_BYTES_INVALID",
      };
    }

    const result = multiplexer.subscribe(streamId, {
      agentSessionId,
      subscriptionId,
      replayBytes,
    });
    switch (result) {
      case "ok":
        return { ok: true };
      case "missing-stream":
        reply.code(404);
        return { error: "终端流已断开", code: "TERMINAL_STREAM_NOT_FOUND" };
      case "missing-session":
        reply.code(404);
        return {
          error: "没有找到 PTY 会话",
          code: "TERMINAL_SESSION_NOT_FOUND",
        };
      case "conflict":
        reply.code(409);
        return { error: "终端订阅 ID 已绑定其他会话" };
      case "too-many":
        reply.code(409);
        return { error: "终端流订阅数量已达上限" };
      case "invalid":
      default:
        reply.code(400);
        return { error: "终端流订阅无效" };
    }
  });

  fastify.delete<{
    Params: { streamId: string; subscriptionId: string };
  }>(
    "/api/terminal-stream/:streamId/subscriptions/:subscriptionId",
    async (request, reply) => {
      const { streamId, subscriptionId } = request.params;
      if (
        !isValidIdentifier(streamId) ||
        !isValidSubscriptionId(subscriptionId)
      ) {
        reply.code(400);
        return { error: "终端流订阅无效" };
      }

      const result = multiplexer.unsubscribe(streamId, subscriptionId);
      switch (result) {
        case "ok":
          return { ok: true };
        case "missing-stream":
          reply.code(404);
          return { error: "终端流已断开", code: "TERMINAL_STREAM_NOT_FOUND" };
        case "invalid":
        default:
          reply.code(400);
          return { error: "终端流订阅无效" };
      }
    },
  );
}
