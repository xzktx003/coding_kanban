import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCodexFollowups } from "./native-codex-followups.js";

const message = {
  id: "intent",
  threadId: "thread",
  text: "hello",
  images: [],
  parameters: { model: "chosen", personality: "friendly" },
  mode: "queue" as const,
};
function fixture(file?: string) {
  const calls: Array<{ method: string; params: any }> = [];
  const state = { items: [] as any[], loseAck: false, hide: false };
  const runtime = {
    async statuses() {
      return { thread: "idle" };
    },
    async call(method: string, params: any): Promise<any> {
      calls.push({ method, params });
      if (method === "thread/settings/update") return {};
      if (method === "thread/queue/add") {
        const item = {
          id: "official-1",
          clientUserMessageId: params.clientUserMessageId,
          input: params.input,
        };
        state.items.push(item);
        if (state.loseAck) throw new Error("lost ack");
        return { queuedSubmission: item };
      }
      if (method === "thread/queue/list")
        return { data: state.hide ? [] : state.items, nextCursor: null };
      if (method === "thread/queue/delete") {
        state.items = state.items.filter(
          (item) => item.id !== params.queuedSubmissionId,
        );
        return {};
      }
      if (method === "thread/queue/update") {
        const item = state.items.find(
          (item) => item.id === params.queuedSubmissionId,
        );
        item.input = params.input;
        return {};
      }
      if (method === "thread/queue/start" || method === "turn/interrupt")
        return {};
      throw new Error(method);
    },
  };
  return {
    queue: new NativeCodexFollowups(runtime, file),
    calls,
    state,
    runtime,
  };
}

test("official queue is authoritative; captured settings apply before add and tick never sends a turn", async () => {
  const f = fixture();
  const result = await f.queue.submit(message);
  await f.queue.tick();
  assert.equal(result.authority, "native");
  assert.deepEqual(
    f.calls.slice(0, 2).map((c) => c.method),
    ["thread/settings/update", "thread/queue/add"],
  );
  assert.deepEqual(f.calls[0].params, {
    threadId: "thread",
    model: "chosen",
    personality: "friendly",
  });
  assert.equal(
    f.calls.some((c) => c.method === "turn/start"),
    false,
  );
  assert.equal(result.items[0].nativeQueuedSubmissionId, "official-1");
  assert.deepEqual(result.items[0].parameters, {});
});

test("unknown add is reconciled against native client ID and never duplicated after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-outbox-"));
  try {
    const f = fixture(join(dir, "legacy.json"));
    f.state.loseAck = true;
    const first = await f.queue.submit(message);
    assert.equal(first.items[0].status, "queued");
    const restarted = new NativeCodexFollowups(
      f.runtime,
      join(dir, "legacy.json"),
    );
    await restarted.submit(message);
    assert.equal(
      f.calls.filter((c) => c.method === "thread/queue/add").length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown add absent from native list remains uncertain and is never inferred unsent", async () => {
  const f = fixture();
  f.state.loseAck = true;
  f.state.hide = true;
  await f.queue.submit(message);
  f.state.items = [];
  const snapshot = await f.queue.get("thread");
  assert.equal(
    snapshot.items.find((m) => m.id === message.id)?.status,
    "uncertain",
  );
  await f.queue.submit(message);
  assert.equal(
    f.calls.filter((c) => c.method === "thread/queue/add").length,
    1,
  );
});

test("legacy frozen queued work stays visible, paused and is never dispatched automatically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-legacy-"));
  try {
    const file = join(dir, "legacy.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        threads: {
          thread: {
            revision: 2,
            paused: null,
            items: [
              {
                ...message,
                createdAt: 1,
                status: "queued",
                fingerprint: "legacy",
              },
            ],
          },
        },
      }),
    );
    const f = fixture(file),
      result = await f.queue.get("thread");
    assert.equal(result.items[0].authority, "legacy");
    assert.ok(result.paused);
    await f.queue.tick();
    assert.equal(
      f.calls.some(
        (c) => c.method === "thread/queue/add" || c.method === "turn/start",
      ),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local pause cannot claim to pause accepted native work; resume uses official queue/start", async () => {
  const f = fixture();
  let snapshot = await f.queue.submit(message);
  await assert.rejects(
    f.queue.change("thread", snapshot.revision, { type: "pause" }),
    /原生队列/,
  );
  await f.queue.change("thread", snapshot.revision, { type: "resume" });
  assert.equal(
    f.calls.filter((c) => c.method === "thread/queue/start").length,
    1,
  );
});
test("duplicate official client IDs retain separate queue identities and delete the exact row", async () => {
  const f = fixture();
  f.state.items = [
    {
      id: "native-first",
      clientUserMessageId: "same-client",
      input: [{ type: "text", text: "first" }],
    },
    {
      id: "native-second",
      clientUserMessageId: "same-client",
      input: [{ type: "text", text: "second" }],
    },
  ];
  const before = await f.queue.get("thread");
  assert.equal(new Set(before.items.map((item) => item.id)).size, 2);
  await f.queue.change("thread", before.revision, {
    type: "delete",
    id: before.items[1].id,
  });
  assert.deepEqual(
    f.state.items.map((item) => item.id),
    ["native-first"],
  );
});

test("review captures native scope and an unknown receipt survives restart without another start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-review-"));
  try {
    const file = join(dir, "legacy.json"),
      f = fixture(file);
    let starts = 0;
    const runtime = {
      ...f.runtime,
      context: async () => ({ scope: "scope-a", namespace: "account-a" }),
      guardedCall: async (
        method: string,
        _params: any,
        expectedScope: string,
      ) => {
        assert.equal(expectedScope, "scope-a");
        assert.equal(method, "review/start");
        starts++;
        throw new Error("ack lost");
      },
    };
    const queue = new NativeCodexFollowups(runtime, file);
    const result = await queue.review(
      "thread",
      "detached",
      { type: "uncommittedChanges" },
      "review-op",
      "scope-a",
    );
    assert.equal(result.status, "unknown");
    const restarted = new NativeCodexFollowups(runtime, file);
    assert.equal(
      (await restarted.reviewReceipt("thread", "review-op", "scope-a"))?.status,
      "unknown",
    );
    assert.equal(
      (
        await restarted.review(
          "thread",
          "detached",
          { type: "uncommittedChanges" },
          "review-op",
          "scope-a",
        )
      ).status,
      "unknown",
    );
    assert.equal(starts, 1);
    await assert.rejects(
      restarted.review(
        "thread",
        "detached",
        { type: "uncommittedChanges" },
        "other-op",
        "scope-a",
      ),
      /审查/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown queue deletion never repeats and never silently restores a possibly executed message", async () => {
  const f = fixture();
  const old = f.runtime.call;
  f.state.items = [
    {
      id: "remove-me",
      clientUserMessageId: "external",
      input: [{ type: "text", text: "saved content" }],
    },
  ];
  f.runtime.call = async (method, params) => {
    const result = await old(method, params);
    if (method === "thread/queue/delete") throw new Error("delete ack lost");
    return result;
  };
  const before = await f.queue.get("thread");
  const result = await f.queue.change(
    "thread",
    before.revision,
    { type: "delete", id: before.items[0].id },
    undefined,
    "delete-once",
  );
  assert.equal(result.operation?.status, "unknown");
  await f.queue.change(
    "thread",
    before.revision,
    { type: "delete", id: before.items[0].id },
    undefined,
    "delete-once",
  );
  assert.equal(
    f.calls.filter((call) => call.method === "thread/queue/delete").length,
    1,
  );
  assert.equal(
    f.calls.some((call) => call.method === "thread/queue/add"),
    false,
  );
  assert.ok(
    result.items.some(
      (item) => item.text === "saved content" && item.status === "uncertain",
    ),
  );
});

test("deletion undo requires explicit execution confirmation and restores saved input only once", async () => {
  const f = fixture();
  const old = f.runtime.call;
  f.runtime.call = async (method, params) => {
    if (method === "thread/read")
      return {
        thread: {
          id: "thread",
          status: { type: "idle" },
          canAcceptDirectInput: true,
        },
      };
    return old(method, params);
  };
  f.state.items = [
    {
      id: "remove-me",
      clientUserMessageId: "external",
      input: [
        { type: "text", text: "saved content" },
        { type: "localImage", path: "/image" },
      ],
    },
  ];
  const before = await f.queue.get("thread");
  const deleted = await f.queue.change(
    "thread",
    before.revision,
    { type: "delete", id: before.items[0].id },
    undefined,
    "delete-confirmed",
  );
  assert.ok(deleted.undo);
  await assert.rejects(
    f.queue.change(
      "thread",
      deleted.revision,
      { type: "undo", token: deleted.undo!.token },
      undefined,
      "undo-no-confirm",
    ),
    /立即执行|确认/,
  );
  assert.equal(
    f.calls.some((call) => call.method === "thread/queue/add"),
    false,
  );
  const restored = await f.queue.change(
    "thread",
    deleted.revision,
    { type: "undo", token: deleted.undo!.token, confirmExecution: true },
    undefined,
    "undo-confirmed",
  );
  assert.equal(restored.operation?.status, "accepted");
  await f.queue.change(
    "thread",
    deleted.revision,
    { type: "undo", token: deleted.undo!.token, confirmExecution: true },
    undefined,
    "undo-confirmed",
  );
  assert.equal(
    f.calls.filter((call) => call.method === "thread/queue/add").length,
    1,
  );
  assert.ok(
    f.calls
      .find((call) => call.method === "thread/queue/add")
      ?.params.input.some((part: any) => part.path === "/image"),
  );
});

test("edit undo refuses an external queue change instead of overwriting the newer content", async () => {
  const f = fixture();
  f.state.items = [
    {
      id: "edit-me",
      clientUserMessageId: "external",
      input: [{ type: "text", text: "before" }],
    },
  ];
  const before = await f.queue.get("thread");
  const edited = await f.queue.change(
    "thread",
    before.revision,
    { type: "edit", id: before.items[0].id, text: "after" },
    undefined,
    "edit-op",
  );
  assert.ok(edited.undo);
  f.state.items[0].input = [{ type: "text", text: "other client" }];
  const current = await f.queue.get("thread");
  await assert.rejects(
    f.queue.change(
      "thread",
      current.revision,
      { type: "undo", token: edited.undo!.token },
      undefined,
      "undo-stale",
    ),
    /其他客户端|变化/,
  );
  assert.equal(
    f.calls.filter((call) => call.method === "thread/queue/update").length,
    1,
  );
});

test("a changed active turn after queue deletion stops queued steer and preserves its content without compensation", async () => {
  const f = fixture();
  const original = f.runtime.call;
  let turnId = "old";
  f.state.items = [
    {
      id: "steer-me",
      clientUserMessageId: "external",
      input: [{ type: "text", text: "precise content" }],
    },
  ];
  f.runtime.call = async (method, params) => {
    if (method === "thread/read")
      return {
        thread: {
          id: "thread",
          status: { type: "active" },
          canAcceptDirectInput: true,
        },
      };
    if (method === "thread/turns/list")
      return { data: [{ id: turnId, status: "inProgress" }], nextCursor: null };
    const result = await original(method, params);
    if (method === "thread/queue/delete") turnId = "different";
    return result;
  };
  const before = await f.queue.get("thread");
  const result = await f.queue.change(
    "thread",
    before.revision,
    { type: "steer", id: before.items[0].id, expectedTurnId: "old" },
    undefined,
    "precise-steer",
  );
  assert.equal(result.operation?.status, "rejected");
  assert.equal(
    f.calls.some(
      (call) =>
        call.method === "turn/steer" || call.method === "thread/queue/add",
    ),
    false,
  );
  assert.ok(
    result.items.some(
      (item) => item.text === "precise content" && item.status === "failed",
    ),
  );
});

test("a lost undo-add ACK fences the source token across pages even after native queue drains", async () => {
  const f = fixture();
  const original = f.runtime.call;
  f.state.items = [
    {
      id: "delete-token",
      clientUserMessageId: "external",
      input: [{ type: "text", text: "once only" }],
    },
  ];
  f.runtime.call = async (method, params) => {
    if (method === "thread/read")
      return {
        thread: {
          id: "thread",
          status: { type: "idle" },
          canAcceptDirectInput: true,
        },
      };
    const result = await original(method, params);
    if (method === "thread/queue/add") {
      f.state.items = [];
      throw new Error("restore ack lost after native drained");
    }
    return result;
  };
  const before = await f.queue.get("thread");
  const deleted = await f.queue.change(
    "thread",
    before.revision,
    { type: "delete", id: before.items[0].id },
    undefined,
    "delete-fence",
  );
  const first = await f.queue.change(
    "thread",
    deleted.revision,
    { type: "undo", token: deleted.undo!.token, confirmExecution: true },
    undefined,
    "restore-page-a",
  );
  assert.equal(first.operation?.status, "unknown");
  const current = await f.queue.get("thread");
  await assert.rejects(
    f.queue.change(
      "thread",
      current.revision,
      { type: "undo", token: deleted.undo!.token, confirmExecution: true },
      undefined,
      "restore-page-b",
    ),
    /核对|重复/,
  );
  assert.equal(
    f.calls.filter((call) => call.method === "thread/queue/add").length,
    1,
  );
});

test("accepted direct and queued steer retain display-only content across restart until exact native identity appears", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-steer-display-"));
  try {
    const file = join(dir, "legacy.json"),
      f = fixture(file),
      original = f.runtime.call;
    f.runtime.call = async (method, params) => {
      if (method === "turn/steer") return { turnId: params.expectedTurnId };
      if (method === "thread/read")
        return {
          thread: {
            id: "thread",
            status: { type: "active" },
            canAcceptDirectInput: true,
          },
        };
      if (method === "thread/turns/list")
        return {
          data: [{ id: "running", status: "inProgress" }],
          nextCursor: null,
        };
      return original(method, params);
    };
    await f.queue.submit({
      ...message,
      mode: "steer",
      expectedTurnId: "running",
      images: ["/saved.png"],
    });
    f.state.items = [
      {
        id: "steer-row",
        clientUserMessageId: "external",
        input: [{ type: "text", text: "queued supplement" }],
      },
    ];
    const before = await f.queue.get("thread");
    await f.queue.change(
      "thread",
      before.revision,
      { type: "steer", id: before.items[0].id, expectedTurnId: "running" },
      undefined,
      "queued-op",
    );
    const restarted = new NativeCodexFollowups(f.runtime, file);
    const page = await restarted.steerReceipts("thread", undefined, null, 1);
    assert.equal(page.data.length, 1);
    assert.ok(page.nextCursor);
    const second = await restarted.steerReceipts(
      "thread",
      undefined,
      page.nextCursor,
      1,
    );
    assert.deepEqual(
      [...second.data, ...page.data].map((row) => [
        row.clientId,
        row.text,
        row.turnId,
      ]),
      [
        ["intent", "hello", "running"],
        ["queued_steer_queued-op", "queued supplement", "running"],
      ],
    );
    assert.deepEqual(second.data[0].images, ["/saved.png"]);
    await restarted.observe({
      method: "item/completed",
      params: {
        threadId: "thread",
        turnId: "another-turn",
        item: { type: "userMessage", clientId: "intent" },
      },
    });
    assert.equal((await restarted.steerReceipts("thread")).data.length, 2);
    await restarted.observe({
      method: "item/completed",
      params: {
        threadId: "thread",
        turnId: "running",
        item: { type: "userMessage", clientId: "intent" },
      },
    });
    assert.deepEqual(
      (await restarted.steerReceipts("thread")).data.map((row) => row.clientId),
      ["queued_steer_queued-op"],
    );
    assert.equal(
      f.calls.some((call) => call.method === "turn/start"),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
