import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCodexRoutes } from "./routes.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";

test("selected detail rejects extra parameters without touching shared RPC", async (t) => {
  const app = Fastify();
  const service = new CodexService({
    hub: new EventHub(),
    instance: "detail-test",
    sweepIntervalMs: 0,
  });
  let calls = 0;
  Object.assign(service, {
    raw: async () => {
      calls++;
      throw Error("shared reader forbidden");
    },
  });
  registerCodexRoutes(app, service);
  t.after(async () => {
    await app.close();
    await service.close();
  });
  const r = await app.inject({
    method: "POST",
    url: "/api/codex/thread/item-detail",
    payload: {
      threadId: "t",
      turnId: "u",
      itemId: "i",
      expectedType: "commandExecution",
      path: "/forbidden",
    },
  });
  assert.equal(r.statusCode, 400);
  assert.equal(calls, 0);
});
