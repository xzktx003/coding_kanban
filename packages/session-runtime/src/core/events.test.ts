import assert from "node:assert/strict";
import { test } from "node:test";
import { EventHub, eventNamespace } from "./events.js";

const request = {
  threadId: "child",
  turnId: "turn",
  itemId: "item",
  requestId: 1,
  type: "commandExecution",
  requestToken: "instance-1",
};

test("replay and live delivery share one cursor and preserve namespace filtering", async () => {
  const hub = new EventHub();
  hub.publish("codex:notification", { n: 1 });
  hub.publish("cc-message", { n: 2 });
  hub.publish("codex:notification", { n: 3 });
  const sub = hub.subscribe({
    since: 1,
    agents: "codex, terminal",
    snapshots: false,
  });
  assert.deepEqual(
    sub.backlog.map((e) => e.seq),
    [3],
  );
  hub.publish("codex:notification", { n: 4 });
  const live = await sub.next();
  assert.equal(live.value?.seq, 4);
  sub.close();
  assert.equal(hub.subscriberCount, 0);
  assert.deepEqual(
    [
      "codex:notification",
      "codex/approval-request",
      "cc-message",
      "cc-permission-request",
      "acp-message",
      "fs_change",
    ].map(eventNamespace),
    ["codex", "codex", "cc", "cc", "acp", "fs"],
  );
});

test("pending approvals and questions survive bounded replay and reconcile fresh clients", () => {
  const hub = new EventHub({ replayCapacity: 2 });
  hub.publish("codex/approval-request", request);
  hub.publish("codex/request-user-input", {
    ...request,
    requestId: "1",
    type: "requestUserInput",
  });
  for (let i = 0; i < 4; i++)
    hub.publish("codex:notification", { method: "delta" });
  const sub = hub.subscribe({ snapshots: true });
  assert.equal(sub.backlog.length, 2);
  assert.equal(sub.backlog[0].event, "codex/user-input-snapshot");
  assert.deepEqual(
    sub.backlog.map((e) => e.seq),
    [6, 6],
  );
  assert.equal((sub.backlog[1].payload.requests as unknown[]).length, 2);
  sub.close();
});

test("approval identity includes typed request ID, thread, turn, item, kind and instance; only one reply wins", () => {
  const hub = new EventHub();
  hub.publish("codex/approval-request", request);
  for (const field of [
    "threadId",
    "turnId",
    "itemId",
    "requestToken",
    "type",
  ]) {
    assert.equal(
      hub.claimReply(
        { ...request, [field]: "wrong" },
        1,
        "codex/approval-request",
        "commandExecution",
      ),
      false,
    );
  }
  assert.equal(
    hub.claimReply(request, "1", "codex/approval-request", "commandExecution"),
    false,
  );
  assert.equal(
    hub.claimReply(request, 1, "codex/approval-request", "commandExecution"),
    true,
  );
  assert.equal(
    hub.claimReply(request, 1, "codex/approval-request", "commandExecution"),
    false,
  );
  hub.publish("codex:notification", {
    method: "serverRequest/resolved",
    params: { threadId: "child", requestId: 1 },
  });
  assert.equal(
    hub.claimReply(request, 1, "codex/approval-request", "commandExecution"),
    false,
  );
  assert.equal(hub.pendingCount, 0);
});

test("terminal events clear only their own pending requests and a reconnect receives empty snapshots", () => {
  const hub = new EventHub();
  hub.publish("codex/approval-request", request);
  hub.publish("codex/request-user-input", { ...request, threadId: "other" });
  hub.publish("codex:notification", {
    method: "turn/completed",
    params: { threadId: "child", turn: { id: "turn" } },
  });
  assert.equal(hub.pendingCount, 1);
  hub.publish("codex:notification", {
    method: "error",
    params: { threadId: "other", turnId: "turn", willRetry: true },
  });
  assert.equal(hub.pendingCount, 1);
  hub.publish("codex:notification", {
    method: "thread/closed",
    params: { threadId: "other" },
  });
  const sub = hub.subscribe({ since: 5, snapshots: true });
  assert.deepEqual(
    sub.backlog.map((e) => e.payload.requests),
    [[], []],
  );
  sub.close();
});

test("replay is bounded by both bytes and count without dropping live events or pending approval", async () => {
  const hub = new EventHub({ replayCapacity: 2, replayBytes: 250 });
  const sub = hub.subscribe();
  hub.publish("codex/approval-request", request);
  hub.publish("codex:notification", { text: "x".repeat(500) });
  assert.equal((await sub.next()).value?.event, "codex/approval-request");
  assert.equal((await sub.next()).value?.seq, 2);
  assert.ok(hub.replayByteLength <= 250);
  assert.equal(hub.pendingCount, 1);
  const replay = hub.subscribe({ since: 0 });
  assert.equal(replay.backlog.length, 0);
  sub.close();
  replay.close();
});

test("slow consumers disconnect with a replayable cursor instead of silently dropping events", async () => {
  const hub = new EventHub({ subscriberCapacity: 1 });
  const slow = hub.subscribe();
  hub.publish("codex:notification", { n: 1 });
  hub.publish("codex:notification", { n: 2 });
  await assert.rejects(slow.next(), /lagged/);
  assert.equal(hub.subscriberCount, 0);
  const resumed = hub.subscribe({ since: 0 });
  assert.deepEqual(
    resumed.backlog.map((e) => e.seq),
    [1, 2],
  );
  resumed.close();
});

test("runtime reset invalidates pending replies and publisher mutations cannot change replay", () => {
  const hub = new EventHub();
  const value = { ...request };
  hub.publish("codex/approval-request", value);
  value.threadId = "changed";
  assert.equal(
    hub.claimReply(request, 1, "codex/approval-request", "commandExecution"),
    true,
  );
  hub.invalidatePending("codex");
  assert.equal(hub.pendingCount, 0);
  assert.equal(
    hub.claimReply(request, 1, "codex/approval-request", "commandExecution"),
    false,
  );
  const sub = hub.subscribe({ snapshots: true, since: 1 });
  assert.deepEqual(sub.backlog.at(-1)?.payload.requests, []);
  sub.close();
});

test("internal completion subscribers reject tool payloads before queue budgets and keep receiving later turns", async () => {
  const hub = new EventHub({ subscriberCapacity: 2, subscriberBytes: 400 });
  const sub = hub.subscribe({
    agents: "codex",
    filter: (event) => event.payload.method === "turn/completed",
  });
  for (let i = 0; i < 12; i++)
    hub.publish("codex:notification", {
      method: "item/commandExecution/outputDelta",
      params: { delta: "x".repeat(1000) },
    });
  hub.publish("codex:notification", {
    method: "turn/completed",
    params: { threadId: "t", turn: { id: "v", status: "completed" } },
  });
  assert.equal((await sub.next()).value?.payload.method, "turn/completed");
  sub.close();
  hub.close();
});

test("internal projections budget only completion metadata and never alter native subscribers", async () => {
  const hub = new EventHub({ subscriberBytes: 400 });
  const sub = hub.subscribe({
    agents: "codex",
    project: (event) => ({
      ...event,
      payload: { method: event.payload.method },
    }),
  });
  const published = hub.publish("codex:notification", {
    method: "turn/completed",
    params: { turn: { items: [{ output: "x".repeat(2000) }] } },
  });
  assert.deepEqual((await sub.next()).value?.payload, {
    method: "turn/completed",
  });
  assert.match(JSON.stringify(published.payload), /xxxx/);
  sub.close();
  hub.close();
});
