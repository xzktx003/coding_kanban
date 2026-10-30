import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";

test("the fixed lifecycle context exposes only a validated optional native daemon endpoint identity", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const scope = "a".repeat(64), namespace = "b".repeat(64), daemonIdentity = "c".repeat(64);
  let identity: unknown = daemonIdentity;
  const calls: string[] = [];
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1",
    loadDetailChannel: async () => ({ registerLocalItemDetailChannel() {}, registerLocalChatHistoryChannel() {} }),
    fetch: async (url) => {
      calls.push(String(url));
      assert.equal(new URL(String(url)).pathname, "/api/internal/codex/operation-context");
      return new Response(JSON.stringify({ scope, namespace, ...(identity === undefined ? {} : { daemonIdentity: identity }), authToken: "DO_NOT_EXPOSE" }), { headers: { "content-type": "application/json" } });
    },
  });
  const proof = await app.inject("/api/session/lifecycle/context");
  assert.equal(proof.statusCode, 200, proof.body);
  assert.equal(proof.headers["cache-control"], "no-store");
  assert.deepEqual(proof.json(), { scopeToken: scope, namespace, daemonIdentity });
  for (identity of [undefined, "not-an-identity", { pid: 123 }, "d".repeat(4096)]) {
    const response = await app.inject("/api/session/lifecycle/context");
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { scopeToken: scope, namespace });
  }
  assert.equal(calls.length, 5);
});
