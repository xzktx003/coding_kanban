import test from "node:test";
import assert from "node:assert/strict";
import { EventHub } from "../core/events.js";
import { codexRunner } from "./automation.js";
import type { Json } from "../core/json.js";
test("automation waits for its exact turn and handles completion preceding start receipt", async () => {
  const hub = new EventHub();
  const seen: string[] = [];
  let started = "";
  const run = codexRunner(
    {
      call: async (method, params): Promise<Json> => {
        seen.push(method);
        if (method === "thread/start") return { thread: { id: "t" } };
        hub.publish("codex:notification", {
          method: "turn/completed",
          params: { threadId: "other", turn: { id: "x", status: "failed" } },
        });
        hub.publish("codex:notification", {
          method: "turn/completed",
          params: { threadId: "t", turn: { id: "v", status: "completed" } },
        });
        return { turn: { id: "v" } };
      },
    },
    hub,
  );
  assert.equal(
    await run({
      taskId: "task",
      taskName: "test",
      prompt: "hello",
      model: "m",
      modelProvider: "p",
      signal: new AbortController().signal,
      onStarted: (id) => {
        started = id;
      },
    }),
    "finished",
  );
  assert.equal(started, "t");
  assert.deepEqual(seen, ["thread/start", "turn/start"]);
  assert.equal(hub.subscriberCount, 0);
});
test("abort interrupts only the exact owned automation turn, then releases subscription", async () => {
  const hub = new EventHub(),
    controller = new AbortController();
  const calls: { method: string; params: Json }[] = [];
  const run = codexRunner(
    {
      call: async (method, params): Promise<Json> => {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "own" } };
        if (method === "turn/start") {
          controller.abort();
          return { turn: { id: "turn" } };
        }
        return {};
      },
    },
    hub,
  );
  await assert.rejects(
    run({
      taskId: "task",
      taskName: "test",
      prompt: "hello",
      model: "m",
      modelProvider: "p",
      signal: controller.signal,
      onStarted: () => {},
    }),
    /abort/i,
  );
  assert.deepEqual(calls.at(-1), {
    method: "turn/interrupt",
    params: { threadId: "own", turnId: "turn" },
  });
  assert.equal(hub.subscriberCount, 0);
});
