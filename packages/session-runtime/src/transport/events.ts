import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { EventHub, type SubscriptionOptions } from "../core/events.js";
import { HttpError } from "../core/json.js";

function queryOptions(query: unknown): SubscriptionOptions {
  const value = query as { since?: string; agents?: string };
  const since = value.since === undefined ? undefined : Number(value.since);
  if (
    since !== undefined &&
    (!/^\d+$/.test(value.since!) || !Number.isSafeInteger(since) || since < 0)
  )
    throw new HttpError(400, "Invalid event cursor");
  return { since, agents: value.agents, snapshots: true };
}

function writeSse(response: ServerResponse, frame: string): Promise<void> {
  if (response.destroyed)
    return Promise.reject(new Error("Event stream closed"));
  if (response.write(frame)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", drain);
      response.off("close", close);
      response.off("error", error);
    };
    const drain = () => {
      cleanup();
      resolve();
    };
    const close = () => {
      cleanup();
      reject(new Error("Event stream closed"));
    };
    const error = (failure: Error) => {
      cleanup();
      reject(failure);
    };
    response.once("drain", drain);
    response.once("close", close);
    response.once("error", error);
  });
}

function writeWebSocket(socket: WebSocket, frame: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(frame, (error) => (error ? reject(error) : resolve()));
  });
}

export function registerEventRoutes(app: FastifyInstance, hub: EventHub): void {
  app.get("/api/events", async (request, reply) => {
    const subscription = hub.subscribe(queryOptions(request.query));
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.flushHeaders();
    const disconnect = () => subscription.close();
    reply.raw.on("close", disconnect);
    const keepalive = setInterval(() => {
      // Never enqueue keepalives behind a blocked socket.
      if (!reply.raw.destroyed && !reply.raw.writableNeedDrain)
        reply.raw.write(": keepalive\n\n");
    }, 15_000);
    try {
      for (const event of subscription.takeBacklog())
        await writeSse(reply.raw, `data: ${JSON.stringify(event)}\n\n`);
      for await (const event of subscription)
        await writeSse(reply.raw, `data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* Ending forces clients to resume from their last processed sequence. */
    } finally {
      clearInterval(keepalive);
      subscription.close();
      reply.raw.off("close", disconnect);
      reply.raw.end();
    }
  });

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request) => {
        queryOptions(request.query);
      },
    },
    (socket, request) => {
      const subscription = hub.subscribe(queryOptions(request.query));
      const disconnect = () => subscription.close();
      socket.on("close", disconnect);
      socket.on("error", disconnect);
      void (async () => {
        try {
          for (const event of subscription.takeBacklog())
            await writeWebSocket(socket, JSON.stringify(event));
          for await (const event of subscription)
            await writeWebSocket(socket, JSON.stringify(event));
        } catch {
          /* The existing client reconnects with its replay cursor. */
        } finally {
          subscription.close();
          socket.off("close", disconnect);
          socket.off("error", disconnect);
          socket.close();
        }
      })();
    },
  );
}
