import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";
const url = "/api/session/api/codex/thread/item-detail";
test("fixed detail gateway rejects query overrides and never aggregates the upstream response", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1",
    fetch: async () => {
      calls++;
      const response = new Response('{"item":{"full":"body"}}', {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
      for (const key of ["json", "text", "arrayBuffer"] as const)
        response[key] = () => {
          throw Error("aggregation forbidden");
        };
      return response;
    },
  });
  const rejected = await app.inject({
    method: "POST",
    url: url + "?method=thread/resume",
    payload: {},
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls, 0);
  const response = await app.inject({ method: "POST", url, payload: {} });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body, '{"item":{"full":"body"}}');
});

test("detail gateway forwards every runtime status and keeps no-store", async (t) => {
  for (const status of [400, 404, 409, 429, 501, 502, 503, 504]) {
    const app = Fastify();
    registerSessionModeRoutes(app, {
      origin: "http://127.0.0.1:1",
      fetch: async () =>
        new Response('{"error":"DETAIL_TEST"}', {
          status,
          headers: { "content-type": "application/json" },
        }),
    });
    t.after(() => app.close());
    const r = await app.inject({ method: "POST", url, payload: {} });
    assert.equal(r.statusCode, status);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.json().error, "DETAIL_TEST");
  }
});

test("disconnect before upstream headers aborts the fixed gateway fetch", async (t) => {
  const { request } = await import("node:http");
  const app = Fastify();
  t.after(() => app.close());
  let arrived!: () => void, aborted!: () => void;
  const arrival = new Promise<void>((r) => (arrived = r)),
    abort = new Promise<void>((r) => (aborted = r));
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1",
    fetch: async (_url, init) => {
      arrived();
      return await new Promise((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => {
            aborted();
            reject(Error("PRIVATE_NATIVE_TEXT"));
          },
          { once: true },
        ),
      );
    },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const req = request(address + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  req.on("error", () => {});
  req.end("{}");
  await arrival;
  req.destroy();
  await abort;
});

test("disconnect during body cancels upstream and malformed upstream body stays incomplete", async (t) => {
  const { request } = await import("node:http");
  const { registerSessionItemDetail } =
    await import("./session-item-detail.js");
  const app = Fastify();
  t.after(() => app.close());
  let cancelled!: () => void;
  const cancellation = new Promise<void>((r) => (cancelled = r));
  let count = 0;
  registerSessionItemDetail(
    app,
    () => "http://127.0.0.1:1",
    async () => {
      count++;
      if (count === 1)
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(4096)));
            },
            cancel() {
              cancelled();
            },
          }),
        );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"item":'));
            setTimeout(
              () => controller.error(Error("PRIVATE_NATIVE_BODY")),
              10,
            );
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => {
    const req = request(
      address + url,
      { method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        res.once("data", () => {
          res.destroy();
          resolve();
        });
      },
    );
    req.on("error", () => {});
    req.end("{}");
  });
  await cancellation;
  const response = await fetch(address + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await assert.rejects(response.text());
});
