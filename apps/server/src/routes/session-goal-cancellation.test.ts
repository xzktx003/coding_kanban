import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";

for (const path of ["set", "clear", "clear-completed"]) {
  test(`Goal ${path} cancellation closes a pending upstream request before response headers`, async () => {
    const upstream = Fastify(),
      gateway = Fastify();
    let entered!: () => void, disconnected!: () => void, release!: () => void;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    upstream.post("/api/codex/thread/goal/" + path, async (_request, reply) => {
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) disconnected();
      });
      entered();
      await ready;
      return { cleared: false };
    });
    const origin = await upstream.listen({ host: "127.0.0.1", port: 0 });
    registerSessionModeRoutes(gateway, { origin });
    const address = await gateway.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = fetch(
        address + "/api/session/api/codex/thread/goal/" + path,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId: "private-fixture" }),
          signal: controller.signal,
        },
      ).catch(() => undefined);
      await pending;
      controller.abort();
      await request;
      await Promise.race([
        cancelled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "The pending Goal request still reached the runtime after browser cancellation",
                ),
              ),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      release();
      await gateway.close();
      await upstream.close();
    }
  });
}
