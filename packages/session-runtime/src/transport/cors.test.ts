import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { originIsAllowed, registerRuntimeCors } from "./cors.js";

test("CORS retains loopback, Tauri, Tailscale and exact explicit origins", () => {
  for (const origin of [
    "http://localhost:7420",
    "https://127.0.0.1",
    "http://[::1]:7420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://workstation.tail1234.ts.net",
  ])
    assert(originIsAllowed(origin));
  for (const origin of [
    "https://evil.example",
    "https://evil-ts.net",
    "https://ts.net.evil.example",
    "http://localhost@evil.example",
    "https://localhost/path",
    "null",
    "file://",
    "https://workstation.ts.net@evil.example",
  ])
    assert(!originIsAllowed(origin), origin);
  assert(originIsAllowed("https://custom.example", ["https://custom.example"]));
  assert(
    !originIsAllowed("https://custom.example:444", ["https://custom.example"]),
  );
});
test("preflight advertises the legacy methods and headers, but actual remote requests retain token auth", async () => {
  const app = Fastify();
  registerRuntimeCors(app, { allowedOrigins: ["https://custom.example"] });
  let calls = 0;
  app.addHook("onRequest", async (r, reply) => {
    if (r.headers.authorization !== "Bearer test")
      return reply.code(401).send({ error: "Unauthorized" });
  });
  app.post("/api/test", () => {
    calls++;
    return { ok: true };
  });
  try {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/test",
      headers: {
        origin: "https://custom.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(
      preflight.headers["access-control-allow-origin"],
      "https://custom.example",
    );
    assert.equal(
      preflight.headers["access-control-allow-methods"],
      "GET, POST",
    );
    assert.equal(
      preflight.headers["access-control-allow-headers"],
      "Content-Type, Authorization",
    );
    assert.equal(calls, 0);
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/test",
      headers: { origin: "https://custom.example" },
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(calls, 0);
    const success = await app.inject({
      method: "POST",
      url: "/api/test",
      headers: {
        origin: "https://custom.example",
        authorization: "Bearer test",
      },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(
      success.headers["access-control-allow-origin"],
      "https://custom.example",
    );
    assert.match(String(success.headers.vary), /Origin/);
    assert.equal(calls, 1);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/test",
      headers: { origin: "https://evil.example", authorization: "Bearer test" },
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.headers["access-control-allow-origin"], undefined);
    assert.equal(calls, 1);
    assert.equal(
      (
        await app.inject({
          method: "OPTIONS",
          url: "/api/test",
          headers: {
            origin: "https://custom.example",
            "access-control-request-method": "DELETE",
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "OPTIONS",
          url: "/api/test",
          headers: {
            origin: "https://custom.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "x-admin",
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});
