import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexFollowups, type FollowupRuntime } from "./codex-followups.js";
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
  const runtime: FollowupRuntime = {
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
test("a fresh active event prevents a stale idle snapshot from sending", async () => {
  const f = fixture();
  let release!: (v: Record<string, string>) => void;
  f.runtime.statuses = () =>
    new Promise((r) => {
      release = r;
    });
  const q = new CodexFollowups(f.runtime);
  await q.submit(input());
  const tick = q.tick();
  await new Promise((r) => setImmediate(r));
  const event = q.observe({
    method: "turn/started",
    params: { threadId: "a", turn: { id: "new-active" } },
  });
  release({ a: "idle" });
  await tick;
  await event;
  assert.equal(f.calls.length, 0);
});
test("a failed turn pauses the queue, and reused request ids cannot change the payload", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  await q.submit(input());
  await assert.rejects(q.submit({ ...input(), text: "different" }));
  f.states.a = "idle";
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "failed", status: "failed" } },
  });
  await q.tick();
  assert.equal(f.calls.length, 0);
  assert.ok((await q.get("a")).paused);
});
test("gateway restart does not advance a queue whose last accepted turn has no completion receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "followups-recovery-"));
  try {
    const f = fixture(),
      file = join(root, "queue.json"),
      q = new CodexFollowups(f.runtime, file);
    f.states.a = "idle";
    await q.submit(input());
    await q.submit(input("two"));
    await q.tick();
    assert.equal(f.calls.length, 1);
    const recovered = new CodexFollowups(f.runtime, file);
    f.states.a = "idle";
    await recovered.tick();
    assert.equal(f.calls.length, 1);
    assert.ok((await recovered.get("a")).paused);
    await recovered.observe({
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "turn-one", status: "completed" } },
    });
    await recovered.tick();
    assert.equal(f.calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("idle snapshots cannot replace the completion receipt of an accepted turn", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  f.states.a = "idle";
  await q.submit(input());
  await q.submit(input("two"));
  await q.tick();
  f.states.a = "idle";
  await q.tick();
  assert.equal(f.calls.length, 1);
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "turn-one", status: "completed" } },
  });
  await q.tick();
  assert.equal(f.calls.length, 2);
});
test("inline review is serialized against queued work; detached review preserves it", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  f.states.a = "idle";
  await q.submit(input());
  f.runtime.call = async (method, params) => {
    f.calls.push({ method, params });
    return {
      reviewThreadId: params.delivery === "detached" ? "side" : "a",
      turn: { id: "review" },
    };
  };
  await assert.rejects(q.review("a", "inline", { type: "uncommittedChanges" }));
  await q.review("a", "detached", { type: "uncommittedChanges" });
  assert.equal((await q.get("a")).paused, null);
  assert.equal((await q.get("a")).items[0].status, "queued");
  const s = await q.get("a");
  await q.change("a", s.revision, { type: "pause" });
  await q.review("a", "inline", { type: "uncommittedChanges" });
  assert.equal(f.calls.length, 2);
});
test("new threads absent from state DB can send after a trusted native thread response", async () => {
  const f = fixture();
  f.runtime.statuses = async () => ({});
  const q = new CodexFollowups(f.runtime);
  await q.submit(input());
  await q.tick();
  assert.equal(f.calls.length, 0);
  await q.observe({
    method: "thread/started",
    params: { thread: { id: "a", status: { type: "idle" } } },
  });
  await q.tick();
  assert.equal(f.calls.length, 1);
});
test("native review completion may use the review id rather than the execution turn id", async () => {
  const f = fixture();
  f.states.a = "idle";
  f.runtime.call = async () => ({
    reviewThreadId: "a",
    turn: { id: "review", status: "inProgress" },
  });
  const q = new CodexFollowups(f.runtime);
  await q.review("a", "inline", { type: "custom", instructions: "check" });
  await q.observe({
    method: "turn/started",
    params: { threadId: "a", turn: { id: "execution" } },
  });
  await q.observe({
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: { id: "review", status: "completed", durationMs: 12 },
    },
  });
  assert.equal((await q.get("a")).awaitingTurnId, undefined);
  assert.deepEqual((await q.get("a")).review, {
    turnId: "review",
    executionTurnId: "execution",
    status: "completed",
    durationMs: 12,
  });
});
test("paginated native threads use an independent fork for detached review", async () => {
  const { FollowupRejected } = await import("./codex-followups.js");
  const f = fixture();
  f.runtime.call = async (method, params) => {
    f.calls.push({ method, params });
    if (method === "review/start" && params.delivery === "detached")
      throw new FollowupRejected(
        "paginated threads do not support detached review",
      );
    if (method === "thread/fork") return { thread: { id: "fork-review" } };
    return {
      reviewThreadId: "fork-review",
      turn: { id: "review", status: "inProgress" },
    };
  };
  const q = new CodexFollowups(f.runtime);
  await q.submit(input());
  const result = await q.review("a", "detached", {
    type: "custom",
    instructions: "check",
  });
  assert.equal(result.reviewThreadId, "fork-review");
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["review/start", "thread/fork", "review/start"],
  );
  assert.equal(f.calls.at(-1)?.params.threadId, "fork-review");
  assert.equal((await q.get("a")).items[0].status, "queued");
});
test("an event gap invalidates an in-flight idle snapshot before dispatch", async () => {
  const f = fixture();
  let release!: (v: Record<string, string>) => void;
  f.runtime.statuses = () =>
    new Promise((r) => {
      release = r;
    });
  const q = new CodexFollowups(f.runtime);
  await q.submit(input());
  const tick = q.tick();
  await new Promise((r) => setImmediate(r));
  const recover = q.recover("events missing");
  release({ a: "idle" });
  await tick;
  await recover;
  assert.equal(f.calls.length, 0);
  assert.equal((await q.get("a")).paused, "events missing");
});

test("an explicitly resumed queue starts a new turn after systemError instead of remaining stuck", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  await q.submit(input("before"));
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "old", status: "failed" } },
  });
  f.states.a = "systemError";
  await q.submit(input("retry"));
  await q.tick();
  assert.equal(
    f.calls.length,
    0,
    "failure still requires explicit queue resume",
  );
  const state = await q.get("a");
  await q.change("a", state.revision, { type: "resume" });
  await q.tick();
  assert.equal(f.calls[0]?.method, "turn/start");
  assert.equal(f.calls[0]?.params.clientUserMessageId, "before");
  assert.equal(f.calls[0]?.params.expectedTurnId, undefined);
  await q.tick();
  assert.equal(f.calls.length, 1);
});

test("an unloaded thread is acquired by the runtime before dispatch; queue holds bracket the operation", async () => {
  const f = fixture();
  f.states.a = "notLoaded";
  const holds: Array<{ busy: boolean; threadIds: string[] }> = [];
  const q = new CodexFollowups({
    ...f.runtime,
    syncHolds: async (snapshot: { busy: boolean; threadIds: string[] }) => {
      holds.push(snapshot);
    },
  });
  await q.submit(input());
  assert.deepEqual(holds.at(-1), { busy: false, threadIds: ["a"] });
  await q.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].params.clientUserMessageId, "one");
  assert.equal(holds.at(-2)?.busy, true);
  assert.deepEqual(holds.at(-1)?.threadIds, ["a"]);
  await q.observe({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "turn-one", status: "completed" } },
  });
  assert.deepEqual(holds.at(-1)?.threadIds, []);
});

test("queue ownership handshake failure prevents submission and dispatch", async () => {
  const f = fixture();
  const q = new CodexFollowups({
    ...f.runtime,
    syncHolds: async () => {
      throw new Error("handoff unavailable");
    },
  });
  await assert.rejects(q.submit(input()), /handoff unavailable/);
  assert.equal(f.calls.length, 0);
});

test("external writer conflict preserves submission identity and attachments; explicit retry sends once", async () => {
  const { FollowupRejected } = await import("./codex-followups.js");
  const f = fixture();
  f.states.a = "notLoaded";
  const q = new CodexFollowups(f.runtime);
  const message = { ...input(), images: ["/fixture/preserved.png"] };
  await q.submit(message);
  f.fail(new FollowupRejected("SESSION_OWNED_ELSEWHERE: occupied"));
  await q.tick();
  const failed = await q.get("a");
  assert.equal(failed.items[0].status, "failed");
  assert.deepEqual(failed.items[0].images, message.images);
  await q.tick();
  assert.equal(f.calls.length, 1);
  f.fail();
  await q.change("a", failed.revision, { type: "retry", id: message.id });
  await q.tick();
  await q.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].params.clientUserMessageId, message.id);
  assert.deepEqual((f.calls[1].params.input as any[]).at(-1), {
    type: "localImage",
    path: message.images[0],
  });
});

test("a released thread resumes its queued message after read-only history confirms the missed completion", async () => {
  const f = fixture();
  let reads = 0;
  Object.assign(f.runtime, {
    readThread: async (id: string) => {
      reads++;
      return {
        thread: {
          id,
          status: { type: "notLoaded" },
          turns: [{ id: "turn-one", status: "completed" }],
        },
      };
    },
  });
  const q = new CodexFollowups(f.runtime);
  f.states.a = "idle";
  await q.submit(input());
  await q.tick();
  await q.submit({ ...input("two"), images: ["/original.png"] });
  f.states.a = "notLoaded";
  await q.tick();
  await q.tick();
  assert.equal(reads, 1);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["turn/start", "turn/start"],
  );
  assert.equal(f.calls[1].params.clientUserMessageId, "two");
  assert.deepEqual((f.calls[1].params.input as any[])[1], {
    type: "localImage",
    path: "/original.png",
  });
  assert.equal((await q.get("a")).items[1].status, "sent");
});

test("gateway restart reconciles its automatic completion wait from history without resending accepted input", async () => {
  const root = await mkdtemp(join(tmpdir(), "followup-history-"));
  try {
    const f = fixture(),
      file = join(root, "queue.json"),
      q = new CodexFollowups(f.runtime, file);
    Object.assign(f.runtime, {
      readThread: async () => ({
        thread: {
          id: "a",
          status: { type: "notLoaded" },
          turns: [{ id: "turn-one", status: "completed" }],
        },
      }),
    });
    f.states.a = "idle";
    await q.submit(input());
    await q.tick();
    await q.submit(input("two"));
    const restored = new CodexFollowups(f.runtime, file);
    f.states.a = "notLoaded";
    await restored.tick();
    assert.deepEqual(
      f.calls.map((c) => c.params.clientUserMessageId),
      ["one", "two"],
    );
    assert.equal((await restored.get("a")).paused, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const status of ["failed", "interrupted"])
  test(`history reconciliation preserves ${status} protection`, async () => {
    const f = fixture(),
      q = new CodexFollowups(f.runtime);
    Object.assign(f.runtime, {
      readThread: async () => ({
        thread: {
          id: "a",
          status: { type: "notLoaded" },
          turns: [{ id: "turn-one", status }],
        },
      }),
    });
    f.states.a = "idle";
    await q.submit(input());
    await q.tick();
    await q.submit(input("two"));
    f.states.a = "notLoaded";
    await q.tick();
    assert.equal(f.calls.length, 1);
    assert.ok((await q.get("a")).paused);
    assert.equal((await q.get("a")).awaitingTurnId, undefined);
  });

for (const scenario of [
  "missing",
  "inProgress",
  "wrong-thread",
  "newer-failed",
  "unavailable",
  "paused",
])
  test(`history reconciliation cannot release a queue on ${scenario}`, async () => {
    const f = fixture(),
      q = new CodexFollowups(f.runtime);
    Object.assign(f.runtime, {
      readThread: async () => {
        if (scenario === "unavailable") throw new Error("offline");
        return {
          thread: {
            id: scenario === "wrong-thread" ? "b" : "a",
            status: { type: "notLoaded" },
            turns: [
              {
                id: scenario === "missing" ? "another" : "turn-one",
                status: scenario === "inProgress" ? "inProgress" : "completed",
              },
              ...(scenario === "newer-failed"
                ? [{ id: "external", status: "failed" }]
                : []),
            ],
          },
        };
      },
    });
    f.states.a = "idle";
    await q.submit(input());
    await q.tick();
    await q.submit(input("two"));
    if (scenario === "paused")
      await q.change("a", (await q.get("a")).revision, { type: "pause" });
    f.states.a = "notLoaded";
    await q.tick();
    assert.equal(f.calls.length, 1);
    assert.equal((await q.get("a")).items[1].status, "queued");
  });

test("a turn event arriving during history reconciliation invalidates the read and prevents dispatch", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  let resolve!: (value: unknown) => void;
  let reading!: () => void;
  const started = new Promise<void>((r) => {
    reading = r;
  });
  Object.assign(f.runtime, {
    readThread: async () => {
      reading();
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  f.states.a = "idle";
  await q.submit(input());
  await q.tick();
  await q.submit(input("two"));
  f.states.a = "notLoaded";
  const tick = q.tick();
  await started;
  const observed = q.observe({
    method: "turn/started",
    params: { threadId: "a", turn: { id: "new-active" } },
  });
  resolve({
    thread: {
      id: "a",
      status: { type: "notLoaded" },
      turns: [{ id: "turn-one", status: "completed" }],
    },
  });
  await tick;
  await observed;
  assert.equal(f.calls.length, 1);
  assert.equal((await q.get("a")).awaitingTurnId, "turn-one");
});

test("pause requested during a slow history read wins before the next message is dispatched", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  let resolve!: (value: unknown) => void, reading!: () => void;
  const started = new Promise<void>((r) => {
    reading = r;
  });
  Object.assign(f.runtime, {
    readThread: async () => {
      reading();
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  f.states.a = "idle";
  await q.submit(input());
  await q.tick();
  await q.submit(input("two"));
  const revision = (await q.get("a")).revision;
  f.states.a = "notLoaded";
  const tick = q.tick();
  await started;
  const pause = q.change("a", revision, { type: "pause" });
  // Attach a handler before releasing the read, so revision rejection is observed.
  const outcome = pause.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  resolve({
    thread: {
      id: "a",
      status: { type: "notLoaded" },
      turns: [{ id: "turn-one", status: "completed" }],
    },
  });
  await tick;
  const result = await outcome;
  assert.equal(f.calls.length, 1);
  assert.ok("value" in result);
  assert.equal((await q.get("a")).paused, "队列已暂停");
});

test("unavailable completion history is rate limited and retried without resubmitting accepted input", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  let reads = 0;
  Object.assign(f.runtime, {
    readThread: async () => {
      reads++;
      if (reads === 1) throw new Error("offline");
      return {
        thread: {
          id: "a",
          status: { type: "notLoaded" },
          turns: [{ id: "turn-one", status: "completed" }],
        },
      };
    },
  });
  f.states.a = "idle";
  await q.submit(input());
  await q.tick();
  await q.submit(input("two"));
  f.states.a = "notLoaded";
  await q.tick();
  await q.tick();
  t.mock.timers.tick(4999);
  await q.tick();
  assert.equal(reads, 1);
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(1);
  await q.tick();
  assert.equal(reads, 2);
  assert.deepEqual(
    f.calls.map((c) => c.params.clientUserMessageId),
    ["one", "two"],
  );
});

test("a missed completion releases the queue hold even when there is no next queued message", async () => {
  const f = fixture(),
    q = new CodexFollowups(f.runtime);
  const holds: any[] = [];
  Object.assign(f.runtime, {
    syncHolds: async (s: any) => {
      holds.push(s);
    },
    readThread: async () => ({
      thread: {
        id: "a",
        status: { type: "idle" },
        turns: [{ id: "turn-one", status: "completed" }],
      },
    }),
  });
  f.states.a = "idle";
  await q.submit(input());
  await q.tick();
  assert.equal((await q.get("a")).awaitingTurnId, "turn-one");
  f.states.a = "idle";
  await q.tick();
  assert.equal((await q.get("a")).awaitingTurnId, undefined);
  assert.deepEqual(holds.at(-1), { busy: false, threadIds: [] });
  assert.equal(f.calls.length, 1);
});

test("completion reconciliation is bounded and pending messages take priority over old holds",async()=>{
  const f=fixture(),q=new CodexFollowups(f.runtime);const reads:string[]=[];
  Object.assign(f.runtime,{readThread:async(id:string)=>{reads.push(id);return {thread:{id,status:{type:"idle"},turns:[{id:`turn-first-${id}`,status:"completed"}]}};}});
  for(const id of ["a","b","c"]){f.states[id]="idle";await q.submit(input(`first-${id}`,id));}
  await q.tick();
  for(const id of ["a","b","c"])f.states[id]="idle";
  await q.submit(input("next-c","c"));await q.tick();
  assert.equal(reads.length,2);assert.equal(reads[0],"c");
  assert.equal((await q.get("c")).items[1].status,"sent");
  await q.tick();assert.equal(reads.length,3);
  assert.equal((await q.get("a")).awaitingTurnId,undefined);
  assert.equal((await q.get("b")).awaitingTurnId,undefined);
});
