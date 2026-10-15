import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionModeRoutes } from "./session-mode.js";

test("disabled session mode does not import the detail library or start a native reader", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "detail-disabled-"));
  const previous = process.env.SESSION_MODE_ENABLED;
  process.env.SESSION_MODE_ENABLED = "0";
  const app = Fastify();
  let loads = 0;
  t.after(async () => {
    if (previous === undefined) delete process.env.SESSION_MODE_ENABLED;
    else process.env.SESSION_MODE_ENABLED = previous;
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  registerSessionModeRoutes(app, {
    attachmentRoot: join(directory, "attachments"),
    loadDetailChannel: async () => {
      loads++;
      throw Error("must not load");
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail",
    payload: {},
  });
  assert.equal(response.statusCode, 503);
  assert.equal(loads, 0);
});

test("a missing default detail artifact preserves a custom legacy service and its read-only proxy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "detail-legacy-"));
  const app = Fastify();
  let reads = 0;
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  registerSessionModeRoutes(app, {
    attachmentRoot: join(directory, "attachments"),
    origin: "http://127.0.0.1:32123",
    loadDetailChannel: async () => {
      throw Object.assign(Error("artifact missing"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    },
    fetch: async (url, init) => {
      reads++;
      assert.equal(
        String(url),
        "http://127.0.0.1:32123/api/codex/thread/item-detail",
      );
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ error: "DETAIL_UNSUPPORTED" }), {
        status: 501,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail",
    payload: {
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      expectedType: "commandExecution",
    },
  });
  assert.equal(response.statusCode, 501);
  assert.equal(reads, 1);
  assert.equal(response.headers["cache-control"], "no-store");
});
