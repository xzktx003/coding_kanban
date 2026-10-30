import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLifecycle } from "./session-lifecycle.js";

for (const method of ["rename", "settings", "resume", "archive"] as const)
  test(
    `one ${method} operation ID cannot mutate two threads concurrently`,
    { timeout: 3000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "lifecycle-operation-claim-"));
      const writes: Array<{ method: string; threadId: unknown }> = [];
      const lifecycle = new SessionLifecycle({
        file: join(root, "receipts.json"),
        followups: {
          inspect: async () => ({ revision: 1, paused: null, items: [] }),
          pause: async () => {},
        },
        runtime: {
          call: async (name, params): Promise<any> => {
            if (name === "thread/read")
              return {
                thread: { id: params.threadId, status: { type: "idle" } },
              };
            if (name === "thread/turns/list")
              return {
                data: [{ id: "interrupted-source", status: "interrupted" }],
                nextCursor: null,
              };
            if (name === "thread/queue/list")
              return { data: [], nextCursor: null };
            if (name === "thread/goal/get") return { goal: null };
            if (name === "thread/list")
              return {
                data: writes
                  .filter((row) => row.method === "thread/archive")
                  .map((row) => ({ id: row.threadId })),
                nextCursor: null,
              };
            writes.push({ method: name, threadId: params.threadId });
            if (name === "turn/start")
              return {
                turn: {
                  id: `accepted-${params.threadId}`,
                  status: "inProgress",
                },
              };
            return {};
          },
        },
      });
      try {
        const results = await Promise.allSettled(
          ["thread-a", "thread-b"].map((threadId) => {
            const input = { operationId: "same-operation", threadId };
            if (method === "archive")
              return lifecycle.archive({ ...input, mode: "idle" });
            if (method === "resume")
              return lifecycle.resume({
                ...input,
                sourceTurnId: "interrupted-source",
                parameters: {},
              });
            return lifecycle[method]({
              ...input,
              parameters:
                method === "rename"
                  ? { name: "new name" }
                  : { model: "selected" },
            });
          }),
        );
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === "rejected").length,
          1,
        );
        assert.equal(
          writes.length,
          1,
          "one durable operation intent admits at most one native mutation",
        );
        const saved = JSON.parse(
          await readFile(join(root, "receipts.json"), "utf8"),
        );
        const table =
          method === "archive"
            ? saved.archives
            : method === "resume"
              ? saved.resumes
              : saved.settings;
        assert.equal(table["same-operation"].threadId, writes[0].threadId);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

function fixture(file?: string) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const state = {
    status: "idle",
    turn: { id: "old", status: "interrupted" },
    goal: null as null | { status: string },
    queue: [] as unknown[],
    fail: false,
    archived: false,
  };
  const runtime = {
    async call(method: string, params: Record<string, unknown>): Promise<any> {
      calls.push({ method, params });
      if (method === "thread/read")
        return {
          thread: {
            id: "thread",
            status: { type: state.status },
            turns: [state.turn],
          },
        };
      if (method === "thread/turns/list")
        return { data: [state.turn], nextCursor: null };
      if (method === "thread/goal/get") return { goal: state.goal };
      if (method === "thread/goal/set") {
        state.goal = { status: "paused" };
        return { goal: state.goal };
      }
      if (method === "thread/queue/list")
        return { data: state.queue, nextCursor: null };
      if (method === "thread/list")
        return {
          data: state.archived ? [{ id: "thread" }] : [],
          nextCursor: null,
        };
      if (state.fail) throw new Error("connection lost after write");
      if (method === "turn/start")
        return { turn: { id: "new", status: "inProgress" } };
      if (method === "turn/interrupt") {
        state.status = "idle";
        state.turn.status = "interrupted";
        return {};
      }
      if (method === "thread/archive") {
        state.archived = true;
        return {};
      }
      if (method === "thread/unarchive") {
        state.archived = false;
        return {};
      }
      if (method === "thread/settings/update" || method === "thread/name/set")
        return {};
      throw new Error(method);
    },
  };
  let paused = false;
  const followups = {
    async inspect() {
      return { revision: 0, paused: paused ? "paused" : null, items: [] };
    },
    async pause() {
      paused = true;
    },
  };
  return {
    lifecycle: new SessionLifecycle({ file, runtime, followups }),
    runtime,
    followups,
    calls,
    state,
  };
}

test("Resume is one durable empty input intent, independent of duplicate HTTP requests", async () => {
  const f = fixture();
  const input = {
    operationId: "resume-1",
    threadId: "thread",
    sourceTurnId: "old",
    parameters: { model: "captured" },
  };
  const [a, b] = await Promise.all([
    f.lifecycle.resume(input),
    f.lifecycle.resume(input),
  ]);
  assert.equal(a.status, "accepted");
  assert.deepEqual(a, b);
  assert.deepEqual(
    f.calls.filter((c) => c.method === "turn/start"),
    [
      {
        method: "turn/start",
        params: { model: "captured", threadId: "thread", input: [] },
      },
    ],
  );
  await assert.rejects(
    f.lifecycle.resume({ ...input, parameters: { model: "later" } }),
    /标识/,
  );
});

test("Lost Resume acknowledgement stays unknown across restart and is never resent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanban-lifecycle-"));
  try {
    const file = join(dir, "state.json"),
      f = fixture(file);
    f.state.fail = true;
    const input = {
      operationId: "resume-lost",
      threadId: "thread",
      sourceTurnId: "old",
      parameters: {},
    };
    assert.equal((await f.lifecycle.resume(input)).status, "unknown");
    const next = new SessionLifecycle({
      file,
      runtime: f.runtime,
      followups: f.followups,
    });
    assert.equal((await next.resume(input)).status, "unknown");
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Resume refuses a changed turn and active Goal before native writes", async () => {
  for (const kind of ["turn", "goal"] as const) {
    const f = fixture();
    if (kind === "turn") f.state.turn.id = "different";
    else f.state.goal = { status: "active" };
    assert.equal(
      (
        await f.lifecycle.resume({
          operationId: "r-" + kind,
          threadId: "thread",
          sourceTurnId: "old",
          parameters: {},
        })
      ).status,
      "rejected",
    );
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 0);
  }
});

test("ordinary archive refuses a running turn and releases its local admission gate", async () => {
  const f = fixture();
  f.state.status = "active";
  f.state.turn.status = "inProgress";
  const result = await f.lifecycle.archive({
    operationId: "archive-idle",
    threadId: "thread",
    mode: "idle",
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    f.calls.some(
      (c) => c.method === "turn/interrupt" || c.method === "thread/archive",
    ),
    false,
  );
  await f.lifecycle.assertWritable("thread");
});

test("stop-and-archive pauses Goal, stops only captured turn and checks terminal state", async () => {
  const f = fixture();
  f.state.status = "active";
  f.state.turn.status = "inProgress";
  f.state.goal = { status: "active" };
  const result = await f.lifecycle.archive({
    operationId: "archive-stop",
    threadId: "thread",
    expectedTurnId: "old",
    mode: "stop",
  });
  assert.equal(result.status, "archived");
  assert.ok(
    f.calls.findIndex((c) => c.method === "thread/goal/set") <
      f.calls.findIndex((c) => c.method === "turn/interrupt"),
  );
  assert.deepEqual(f.calls.find((c) => c.method === "turn/interrupt")?.params, {
    threadId: "thread",
    turnId: "old",
  });
  await assert.rejects(f.lifecycle.assertWritable("thread"), /归档/);
});

test("pending official queue cannot be disguised as paused by a local flag", async () => {
  const f = fixture();
  f.state.queue = [{ id: "native-pending" }];
  const result = await f.lifecycle.archive({
    operationId: "archive-queue",
    threadId: "thread",
    mode: "stop",
  });
  assert.equal(result.status, "blocked");
  assert.match(result.error!, /原生队列/);
  assert.equal(
    f.calls.some((c) => c.method === "thread/archive"),
    false,
  );
});
test("fresh exact interrupt proof preserves pending native queue during stop-and-archive", async () => {
  const f = fixture();
  f.state.status = "active";
  f.state.turn.status = "inProgress";
  f.state.queue = [
    {
      id: "pending-native",
      clientUserMessageId: "q",
      input: [{ type: "text", text: "preserved" }],
    },
  ];
  const result = await f.lifecycle.archive({
    operationId: "fresh-proof",
    threadId: "thread",
    mode: "stop",
    expectedTurnId: "old",
  });
  assert.equal(result.status, "archived");
  assert.equal(f.state.queue.length, 1);
  assert.equal(
    f.calls.filter((call) => call.method === "turn/interrupt").length,
    1,
  );
  assert.equal(
    f.calls.filter(
      (call) =>
        call.method === "thread/queue/delete" ||
        call.method === "thread/queue/start",
    ).length,
    0,
  );
});

test("different pages cannot Resume the same interrupted source twice", async () => {
  const f = fixture();
  const results = await Promise.all(
    ["page-a", "page-b"].map((operationId) =>
      f.lifecycle.resume({
        operationId,
        threadId: "thread",
        sourceTurnId: "old",
        parameters: {},
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.status),
    ["accepted", "rejected"],
  );
  assert.equal(
    f.calls.filter((call) => call.method === "turn/start").length,
    1,
  );
});

test("archive closes admission and waits for the whole already admitted write", async () => {
  const f = fixture();
  let done!: () => void;
  const write = f.lifecycle.write(
    "thread",
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const archive = f.lifecycle.archive({
    operationId: "gate-wait",
    threadId: "thread",
    mode: "idle",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.lifecycle.assertWritable("thread"), /归档/);
  assert.equal(
    f.calls.some((call) => call.method === "thread/archive"),
    false,
  );
  done();
  await write;
  assert.equal((await archive).status, "archived");
});

test("a scope rejection before the actual settings write is rejected rather than unknown", async () => {
  const f = fixture();
  let reads = 0;
  const lifecycle = new SessionLifecycle({
    runtime: f.runtime,
    followups: f.followups,
    context: async () => ({
      scopeToken: ++reads >= 3 ? "new" : "old",
      namespace: "account",
    }),
  });
  const result = await lifecycle.settings({
    operationId: "scope-settings",
    threadId: "thread",
    parameters: { model: "captured" },
    expectedScope: "old",
  });
  assert.equal(result.status, "rejected");
  assert.equal(f.calls.length, 0);
});

test("archive gate identity includes stable namespace and an old restore token cannot mutate the new account", async () => {
  const f = fixture();
  let context = { scopeToken: "a", namespace: "account-a" };
  const guarded: string[] = [];
  const lifecycle = new SessionLifecycle({
    runtime: {
      ...f.runtime,
      guardedCall: async (method, params, expectedScope) => {
        assert.equal(expectedScope, context.scopeToken);
        guarded.push(method);
        return f.runtime.call(method, params);
      },
    },
    followups: f.followups,
    context: async () => context,
  });
  assert.equal(
    (
      await lifecycle.archive({
        operationId: "account-archive",
        threadId: "thread",
        mode: "idle",
        expectedScope: "a",
      })
    ).status,
    "archived",
  );
  await assert.rejects(lifecycle.assertWritable("thread"), /归档/);
  context = { scopeToken: "b", namespace: "account-b" };
  await lifecycle.assertWritable("thread");
  await assert.rejects(lifecycle.restore("thread", "a"), /账号/);
  assert.deepEqual(guarded, ["thread/archive"]);
});

test("terminal receipt compaction stays bounded and old operation IDs remain idempotent after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanban-lifecycle-compact-"));
  try {
    const file = join(dir, "state.json"),
      f = fixture(file);
    for (let index = 0; index < 70; index++)
      assert.equal(
        (
          await f.lifecycle.rename({
            operationId: "name-" + index,
            threadId: "thread",
            parameters: { name: "N" + index },
          })
        ).status,
        "accepted",
      );
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.ok(Object.keys(saved.settings).length <= 64);
    const next = new SessionLifecycle({
      file,
      runtime: f.runtime,
      followups: f.followups,
    });
    assert.equal(
      (
        await next.rename({
          operationId: "name-0",
          threadId: "thread",
          parameters: { name: "N0" },
        })
      ).status,
      "accepted",
    );
    assert.equal(
      f.calls.filter((call) => call.method === "thread/name/set").length,
      70,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a lost archive acknowledgement is reconciled by the archived metadata list without another native archive", async () => {
  const f = fixture();
  let archived = false;
  const original = f.runtime.call;
  f.runtime.call = async (method, params) => {
    if (method === "thread/archive") {
      archived = true;
      f.calls.push({ method, params });
      throw new Error("late disconnect");
    }
    if (method === "thread/list")
      return { data: archived ? [{ id: "thread" }] : [], nextCursor: null };
    return original(method, params);
  };
  const result = await f.lifecycle.archive({
    operationId: "lost-archive",
    threadId: "thread",
    mode: "idle",
  });
  assert.equal(result.status, "unknown");
  assert.equal(
    (await f.lifecycle.archiveReceipt("lost-archive"))?.status,
    "archived",
  );
  assert.equal(
    f.calls.filter((call) => call.method === "thread/archive").length,
    1,
  );
});

test("an unavailable preflight before any native write is blocked rather than an unknown archive", async () => {
  const f = fixture();
  f.runtime.call = async () => {
    throw new Error("metadata unavailable");
  };
  const result = await f.lifecycle.archive({
    operationId: "preflight-offline",
    threadId: "thread",
    mode: "idle",
  });
  assert.equal(result.status, "blocked");
  await f.lifecycle.assertWritable("thread");
});
