import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCodexRoutes } from "./routes.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import type { Json } from "../core/json.js";

test("HTTP readonly history and metadata never implicitly resume; compatibility aliases dispatch exact methods", async (t) => {
  const app = Fastify(),
    service = new CodexService({
      hub: new EventHub(),
      instance: "test",
      sweepIntervalMs: 0,
    });
  const calls: { method: string; params: Json }[] = [];
  const raw = async (method: string, params: Json): Promise<Json> => {
    calls.push({ method, params });
    return {
      config: {
        agents: {
          worker: { description: "safe" },
          token: "secret",
          "bad/name": { description: "hide" },
        },
      },
      thread: { id: "t", turns: [] },
      data: [],
      nextCursor: null,
    };
  };
  Object.assign(service, { raw, call: raw });
  service.readHistory = async (id) => {
    calls.push({ method: "history", params: { id } });
    return { thread: { id, turns: [] } };
  };
  registerCodexRoutes(app, service);
  t.after(() => app.close());
  let r = await app.inject({
    method: "POST",
    url: "/api/codex/thread/metadata",
    payload: { threadId: "t", includeTurns: true },
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls.pop(), {
    method: "thread/read",
    params: { threadId: "t", includeTurns: false },
  });
  r = await app.inject({
    method: "POST",
    url: "/api/codex/thread/read",
    payload: { threadId: "t" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(calls.pop()?.method, "history");
  for (const [path, method] of [
    ["start-thread", "thread/start"],
    ["thread/rename", "thread/name/set"],
    ["mcp/status/list", "mcpServerStatus/list"],
    [
      "external-agent-config/import/read-histories",
      "externalAgentConfig/import/readHistories",
    ],
  ]) {
    r = await app.inject({
      method: "POST",
      url: "/api/codex/" + path,
      payload: { x: true },
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(calls.pop(), { method, params: { x: true } });
  }
  r = await app.inject({
    method: "POST",
    url: "/api/codex/agents/roles",
    payload: { cwd: "/tmp" },
  });
  assert.deepEqual(r.json(), {
    roles: [{ name: "worker", description: "safe" }],
  });
  assert(!calls.some((x) => x.method === "thread/resume"));
});

test("HTTP queue ownership validates u128 and monotonically rejects stale snapshots", async (t) => {
  const app = Fastify(),
    service = new CodexService({
      hub: new EventHub(),
      instance: "test",
      sweepIntervalMs: 0,
    });
  registerCodexRoutes(app, service);
  t.after(() => app.close());
  const send = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/internal/codex/queue-holds",
      payload,
    });
  assert.equal(
    (await send({ sequence: "123", busy: false, threadIds: ["t"] })).statusCode,
    200,
  );
  assert.equal(
    (await send({ sequence: "122", busy: false, threadIds: [] })).statusCode,
    409,
  );
  for (const sequence of ["-1", "1.0", (1n << 128n).toString(), ""])
    assert.equal(
      (await send({ sequence, busy: false, threadIds: [] })).statusCode,
      400,
    );
  assert.equal(
    (await send({ sequence: "124", busy: "false", threadIds: [] })).statusCode,
    400,
  );
});
