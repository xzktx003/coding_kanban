import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexFollowups } from "./codex-followups.js";
import type { FollowupSubmit } from "@agent-orchestrator/shared";
const input = (id = "one", threadId = "a"): FollowupSubmit => ({
  id,
  threadId,
  text: id,
  images: [],
  mode: "queue",
  parameters: { model: "chosen", cwd: "/project" },
});
function fixture() {
  const states: Record<string, string> = { a: "active", b: "idle" };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let failure: Error | undefined;
  const runtime = {
    statuses: async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, states[id] ?? "idle"])),
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (failure) throw failure;
      if (method === "turn/start") {
        states[String(params.threadId)] = "active";
        return {
          turn: {
            id: "turn-" + params.clientUserMessageId,
            status: "inProgress",
          },
        };
      }
      return { turnId: params.expectedTurnId };
    },
  };
  return {
    states,
    calls,
    runtime,
    fail: (error?: Error) => {
      failure = error;
    },
  };
}
test("queues per thread, dispatches one per completed turn, keeps parameter snapshots and deduplicates retries", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  const first = input();
  await q.submit(first);
  first.parameters.model = "changed";
  await q.submit(input());
  await q.submit(input("two"));
  assert.equal((await q.get("a")).items.length, 2);
  assert.equal(f.calls.length, 0);
  f.states.a = "idle";
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "old", status: "completed" } },
  });
  await q.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].params.model, "chosen");
  assert.equal(f.calls[0].params.threadId, "a");
  await q.tick();
  assert.equal(f.calls.length, 1);
  f.states.a = "idle";
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "turn-one", status: "completed" } },
  });
  await q.tick();
  assert.equal(f.calls.length, 2);
});
test("steer keeps the exact turn and excludes next-turn model and permission overrides", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  await q.submit({ ...input(), mode: "steer", expectedTurnId: "running" });
  assert.equal(f.calls[0]?.method, "turn/steer");
  assert.equal(f.calls[0].params.expectedTurnId, "running");
  assert.equal(f.calls[0].params.model, undefined);
  assert.equal((await q.get("a")).items[0].status, "sent");
});
test("stop pauses queued work and replacement waits for the actual interrupted event", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  await q.submit(input());
  await q.submit({
    ...input("replacement"),
    mode: "replace",
    expectedTurnId: "old",
  });
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["turn/interrupt"],
  );
  await q.tick();
  assert.equal(f.calls.length, 1);
  f.states.a = "idle";
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "old", status: "interrupted" } },
  });
  await q.tick();
  assert.equal(f.calls[1]?.method, "turn/start");
  assert.equal(f.calls[1].params.clientUserMessageId, "replacement");
  f.states.a = "idle";
  await q.observe({
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: { id: "turn-replacement", status: "completed" },
    },
  });
  await q.tick();
  assert.equal(f.calls.length, 2);
  const s = await q.get("a");
  assert.ok(s.paused);
  await q.change("a", s.revision, { type: "resume" });
  await q.tick();
  assert.equal(f.calls.length, 3);
});
test("restarts preserve queues and ambiguous delivery never automatically repeats", async () => {
  const root = await mkdtemp(join(tmpdir(), "followups-"));
  try {
    const f = fixture(),
      file = join(root, "queue.json"),
      q = new CodexFollowups(f.runtime, file);
    await q.submit(input());
    const restored = new CodexFollowups(f.runtime, file);
    assert.equal((await restored.get("a")).items.length, 1);
    f.states.a = "idle";
    f.fail(new Error("connection lost"));
    await restored.tick();
    assert.equal((await restored.get("a")).items[0].status, "uncertain");
    f.fail();
    const again = new CodexFollowups(f.runtime, file);
    await again.tick();
    assert.equal(f.calls.length, 1);
    const s = await again.get("a");
    await assert.rejects(
      again.change("a", s.revision, { type: "retry", id: "one" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("editing, order and cancellation require the latest revision; stopping one thread does not stop another", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  await q.submit(input());
  await q.submit(input("two"));
  let s = await q.get("a");
  s = await q.change("a", s.revision, { type: "reorder", ids: ["two", "one"] });
  await assert.rejects(q.change("a", s.revision - 1, { type: "clear" }));
  s = await q.change("a", s.revision, {
    type: "edit",
    id: "two",
    text: "edited",
  });
  assert.equal(s.items[0].text, "edited");
  await q.stop("a", "running");
  await q.submit(input("other", "b"));
  await q.tick();
  assert.equal(f.calls.at(-1)?.params.threadId, "b");
  assert.ok((await q.get("a")).paused);
});
