import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";
import { registerSessionFollowupRoutes } from "./session-followups.js";
import { createSessionRuntimeProtocol } from "../services/session-runtime-protocol.js";

test("new gateway legacy preflight and first-thread creation validate and strip compatibility scope", async () => {
  const app = Fastify();
  let instance = "legacy-one";
  const writes: any[] = [];
  const health = () => ({
    status: "ok",
    instance,
    capabilities: { codexOwnership: true },
  });
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1",
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/health") return Response.json(health());
      if (path === "/api/internal/codex/queue-holds") return Response.json({});
      if (path === "/api/codex/thread/start") {
        writes.push(JSON.parse(String(init?.body)));
        return Response.json({
          thread: { id: "new-thread", status: { type: "idle" } },
        });
      }
      throw new Error(`Unexpected legacy RPC ${path}`);
    },
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const context = (await (
      await fetch(base + "/api/session/lifecycle/context")
    ).json()) as any;
    assert.equal(context.backend, "legacy-stdio");
    const created = await fetch(base + "/api/session/api/codex/thread/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp", expectedScope: context.scopeToken }),
    });
    assert.equal(created.status, 200, await created.text());
    assert.deepEqual(writes, [{ cwd: "/tmp" }]);
    instance = "legacy-two";
    const rejected = await fetch(base + "/api/session/api/codex/thread/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedScope: context.scopeToken }),
    });
    assert.equal(rejected.status, 409);
    assert.equal(writes.length, 1);
  } finally {
    await app.close();
  }
});

test("explicit legacy selects old queue and submits exactly once through HTTP, rejecting changed runtime", async () => {
  const app = Fastify();
  let instance = "legacy-one";
  const calls: string[] = [];
  const health = async () => ({
    status: "ok",
    instance,
    capabilities: { codexOwnership: true },
  });
  const protocol = createSessionRuntimeProtocol(health);
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => "http://127.0.0.1:1",
    protocol,
    autoStart: true,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === "/health") return Response.json(await health());
      if (path === "/api/internal/codex/queue-holds") return Response.json({});
      if (path === "/api/codex/thread/list")
        return Response.json({
          data: [{ id: "new-thread", status: { type: "idle" } }],
          nextCursor: null,
        });
      if (path === "/api/codex/turn/start")
        return Response.json({ turn: { id: "accepted-turn" } });
      if (path === "/api/events")
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.close(),
                { once: true },
              );
            },
          }),
        );
      throw new Error(`Unexpected legacy RPC ${path}`);
    },
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    await new Promise((r) => setTimeout(r, 30));
    const context = await protocol.read();
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const response = await fetch(base + "/api/session/followups/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "submission",
        threadId: "new-thread",
        text: "hello",
        images: [],
        mode: "queue",
        parameters: {},
        expectedScope: context.scopeToken,
      }),
    });
    assert.equal(response.status, 200, await response.text());
    await queue.tick();
    assert.equal(calls.filter((p) => p === "/api/codex/turn/start").length, 1);
    assert.equal(
      calls.some(
        (p) =>
          p.includes("guarded-") ||
          p.includes("operation-context") ||
          p.includes("thread/queue"),
      ),
      false,
    );
    const retry = await fetch(base + "/api/session/followups/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "submission",
        threadId: "new-thread",
        text: "hello",
        images: [],
        mode: "queue",
        parameters: {},
        expectedScope: context.scopeToken,
      }),
    });
    assert.equal(retry.status, 200);
    await queue.tick();
    assert.equal(calls.filter((p) => p === "/api/codex/turn/start").length, 1);
    instance = "legacy-two";
    const failed = await fetch(base + "/api/session/followups/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "second",
        threadId: "new-thread",
        text: "hello",
        images: [],
        mode: "queue",
        parameters: {},
        expectedScope: context.scopeToken,
      }),
    });
    assert.equal(failed.status, 409);
    assert.equal(calls.filter((p) => p === "/api/codex/turn/start").length, 1);
  } finally {
    await app.close();
  }
});
for (const status of [404, 500])
  test(`modern context ${status} never falls back to legacy`, async () => {
    const app = Fastify();
    const calls: string[] = [];
    registerSessionModeRoutes(app, {
      origin: "http://127.0.0.1:1",
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path === "/health")
          return Response.json({
            status: "ok",
            instance: "modern",
            runtime: "typescript",
            codexBackend: "shared-daemon",
            capabilities: { codexOwnership: true },
          });
        return Response.json(
          { error: "native context unavailable" },
          { status },
        );
      },
    });
    try {
      const response = await app.inject("/api/session/lifecycle/context");
      assert.equal(response.statusCode, status);
      assert.equal(response.json().backend, undefined);
      assert.deepEqual(calls, [
        "/health",
        "/api/internal/codex/operation-context",
      ]);
    } finally {
      await app.close();
    }
  });

test("legacy selection freezes persisted queued and unknown sends before any dispatch", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "legacy-frozen-outbox-"));
  const file = join(root, "outbox.json");
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      threads: {
        old: {
          revision: 1,
          paused: null,
          items: [
            {
              id: "old-message",
              threadId: "old",
              mode: "queue",
              text: "do not replay",
              images: [],
              parameters: {},
              status: "queued",
            },
            {
              id: "unknown-message",
              threadId: "old",
              mode: "queue",
              text: "unknown",
              images: [],
              parameters: {},
              status: "uncertain",
            },
          ],
        },
      },
    }),
  );
  const app = Fastify();
  let sends = 0;
  const protocol = createSessionRuntimeProtocol(async () => ({
    status: "ok",
    instance: "legacy",
    capabilities: { codexOwnership: true },
  }));
  const queue = registerSessionFollowupRoutes(app, {
    file,
    origin: () => null,
    protocol,
    autoStart: false,
    runtime: {
      statuses: async () => ({ old: "idle" }),
      call: async () => {
        sends++;
        return { turn: { id: "forbidden" } };
      },
    },
  });
  try {
    const state = await queue.get("old");
    assert.match(state.paused!, /网关已更新/);
    assert.equal(state.items[1].status, "uncertain");
    await queue.tick();
    assert.equal(sends, 0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
