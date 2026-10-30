import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";

for (const path of ["set", "clear", "clear-completed"]) {
  test(`Goal ${path} cancellation closes a pending upstream request before response headers`, { timeout: 5000 }, async () => {
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
    const requests: string[] = [];
    upstream.addHook("onRequest", async request => { requests.push(request.method + " " + request.url); });
    upstream.get("/api/internal/codex/operation-context", async () => ({ scope: "fixture-native-scope", namespace: "fixture-account-history" }));
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
      await Promise.race([
        pending,
        request.then(async response => { throw new Error(`Goal did not reach upstream; gateway ${response?.status}: ${response ? await response.text() : "connection closed"}; upstream ${requests.join(", ")}`); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Goal did not enter upstream within 1s; observed ${requests.join(", ")}`)), 1000); }),
      ]);
      clearTimeout(timer);
      assert.deepEqual(requests, ["GET /api/internal/codex/operation-context", "POST /api/codex/thread/goal/" + path]);
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
      controller.abort();
      release();
      await gateway.close();
      await upstream.close();
    }
  });
}
