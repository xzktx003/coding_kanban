import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerSessionModeRoutes } from "./session-mode.js";

test("session gateway preserves JSON, query parameters and response status", async () => {
  const app = Fastify();
  const requests: Array<{ url: string; body?: string }> = [];
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: init?.body as string });
      return new Response(JSON.stringify({ thread: "one" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/api/codex/thread/start?cursor=a%2Fb",
      payload: { cwd: "/project" },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { thread: "one" });
    assert.equal(
      requests[0].url,
      "http://127.0.0.1:12345/api/codex/thread/start?cursor=a%2Fb",
    );
    assert.deepEqual(JSON.parse(requests[0].body!), { cwd: "/project" });
  } finally {
    await app.close();
  }
});

test("gateway returns an actionable unavailable response", async () => {
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  try {
    const response = await app.inject({ url: "/api/session/health" });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /会话|session/i);
  } finally {
    await app.close();
  }
});

test("gateway rejects attempts to change the upstream or traverse its namespace", async () => {
  for (const origin of [
    "https://example.org",
    "http://10.0.0.1:12345",
    "http://127.0.0.1:12345/private",
  ]) {
    assert.throws(
      () => registerSessionModeRoutes(Fastify(), { origin }),
      /loopback|origin/i,
    );
  }
});

test("binary assets remain byte identical through the gateway", async () => {
  const app = Fastify();
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71]);
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () =>
      new Response(bytes, { headers: { "content-type": "image/png" } }),
  });
  try {
    const response = await app.inject({
      url: "/api/session/api/filesystem/asset?path=%2Fproject%2Fimage.png",
    });
    assert.deepEqual(response.rawPayload, bytes);
    assert.equal(response.headers["content-type"], "image/png");
  } finally {
    await app.close();
  }
});

test("shared project catalog merges local terminal and session paths and excludes remote paths", async () => {
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    projects: () => ["/shared", "/terminal", "~", "/bad\npath"],
    fetch: async () =>
      new Response(
        JSON.stringify({ workspace: { projects: ["/shared", "/session"] } }),
      ),
  });
  try {
    const response = await app.inject("/api/workbench/projects");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().projects, [
      "/shared",
      "/terminal",
      "/session",
    ]);
  } finally {
    await app.close();
  }
});

test("WebSocket gateway retains replay cursors and namespace filters", async () => {
  const { default: websocket } = await import("@fastify/websocket");
  const { WebSocket, WebSocketServer } = await import("ws");
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => upstream.once("listening", resolve));
  const port = (upstream.address() as { port: number }).port;
  const received = new Promise<string>((resolve) =>
    upstream.once("connection", (socket, request) => {
      resolve(request.url!);
      socket.send("connected");
    }),
  );
  const app = Fastify();
  await app.register(websocket);
  await app.register(async (instance) =>
    registerSessionModeRoutes(instance, { origin: `http://127.0.0.1:${port}` }),
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new WebSocket(
    `${app.listeningOrigin.replace(/^http/, "ws")}/ws/session?since=42&agents=terminal`,
  );
  try {
    await new Promise((resolve) => client.once("message", resolve));
    assert.equal(await received, "/ws?since=42&agents=terminal");
  } finally {
    client.close();
    for (const socket of upstream.clients) socket.terminate();
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("browsers cannot forge queue ownership holds through the session proxy", async () => {
  const app = Fastify();
  let calls = 0;
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  try {
    for (const prefix of ["internal", "%69nternal"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/session/api/${prefix}/codex/queue-holds`,
        payload: { busy: false, threadIds: [] },
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});
