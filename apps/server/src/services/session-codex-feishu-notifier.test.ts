import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FeishuCompletionEvent } from "./agent-completion-feishu-notifier.js";
import { SessionCodexFeishuNotifier } from "./session-codex-feishu-notifier.js";

const completion = (
  seq: number,
  turn: any = { id: "turn-one", status: "completed" },
) => ({
  seq,
  event: "codex:notification",
  payload: {
    method: "turn/completed",
    params: { threadId: "thread-one", turn },
  },
});

const finalItem = (text: string, phase = "final_answer") => ({
  type: "agentMessage",
  phase,
  text,
});

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-one",
    name: "主会话",
    cwd: "/workspace/project",
    turns: [
      {
        id: "turn-one",
        status: "completed",
        completedAt: "2026-10-09T01:02:03.000Z",
        items: [
          finalItem("最终回答"),
          finalItem("过程说明", "commentary"),
          { type: "toolCall", text: "private tool" },
        ],
      },
    ],
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForSignal(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("async stage was not reached")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 1000;
  while (!(await check())) {
    assert.ok(Date.now() < end, "condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fixture(
  options: {
    enabled?: boolean;
    file?: string;
    beforeSend?: (target: {
      threadId: string;
      turnId: string;
    }) => Promise<"ready" | "wait" | "superseded">;
  } = {},
) {
  let enabled = options.enabled ?? true;
  const sent: FeishuCompletionEvent[] = [];
  const reads: Array<{ id: string; turnId?: string }> = [];
  let readThread = async (id: string, turnId?: string) => {
    reads.push({ id, turnId });
    return { thread: thread() };
  };
  const notifier = new SessionCodexFeishuNotifier({
    file: options.file,
    beforeSend: options.beforeSend,
    retryIntervalMs: 20,
    settings: {
      get: () => ({ configured: true, enabled }),
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
    readThread: (id, turnId) => readThread(id, turnId),
  });
  return {
    notifier,
    sent,
    reads,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setReadThread: (next: typeof readThread) => {
      readThread = next;
    },
  };
}

test("queues every completed Codex turn with exact final output and stable ids", async () => {
  const f = fixture();

  await f.notifier.observe("runtime-one", completion(7));
  await f.notifier.drain();

  assert.deepEqual(f.reads, [{ id: "thread-one", turnId: "turn-one" }]);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], {
    sessionId: "session-codex:thread-one",
    sessionModeThreadId: "thread-one",
    displayName: "主会话",
    agentKind: "codex",
    workingDirectory: "/workspace/project",
    summary: "最终回答",
    completedAt: "2026-10-09T01:02:03.000Z",
    completionId: "turn-one",
  });
  await f.notifier.close();
});

test("deduplicates replayed events but sends consecutive completed turns", async () => {
  const f = fixture();
  f.setReadThread(async (_id, turnId) => ({
    thread: thread({
      turns: [
        {
          id: turnId,
          status: "completed",
          items: [finalItem(`回答 ${turnId}`)],
        },
      ],
    }),
  }));

  await f.notifier.observe("runtime-one", completion(1));
  await f.notifier.observe("runtime-one", completion(1));
  await f.notifier.observe(
    "runtime-one",
    completion(2, { id: "turn-two", status: "completed" }),
  );
  await f.notifier.drain();

  assert.deepEqual(
    f.sent.map((event) => [event.completionId, event.summary]),
    [
      ["turn-one", "回答 turn-one"],
      ["turn-two", "回答 turn-two"],
    ],
  );
  await f.notifier.close();
});

test("keeps pending notifications durable and retries them after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-"));
  const file = join(root, "notifier.json");
  try {
    let attempts = 0;
    const sent: FeishuCompletionEvent[] = [];
    const first = new SessionCodexFeishuNotifier({
      file,
      retryIntervalMs: 20,
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async () => {
          attempts++;
          throw new Error("offline");
        },
      },
      readThread: async () => ({ thread: thread() }),
    });

    await first.observe("runtime-one", completion(1));
    await first.drain();
    assert.equal(attempts, 1);
    assert.equal(JSON.parse(await readFile(file, "utf8")).cursor, 1);
    await first.close();

    const restored = new SessionCodexFeishuNotifier({
      file,
      retryIntervalMs: 20,
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async (event) => {
          sent.push(event);
        },
      },
      readThread: async () => ({ thread: thread() }),
    });
    assert.equal(await restored.cursor("runtime-one"), 1);
    await restored.drain();
    assert.deepEqual(
      sent.map((event) => event.completionId),
      ["turn-one"],
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).pending, {});
    await restored.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled settings skip observed completions and do not backfill later", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-disabled-"));
  const file = join(root, "notifier.json");
  try {
    const f = fixture({ enabled: false, file });
    await f.notifier.observe("runtime-one", completion(1));
    await f.notifier.drain();
    assert.equal(f.sent.length, 0);
    assert.equal(JSON.parse(await readFile(file, "utf8")).cursor, 1);
    await f.notifier.close();

    const restored = fixture({ enabled: true, file });
    assert.equal(await restored.notifier.cursor("runtime-one"), 1);
    await restored.notifier.drain();
    assert.equal(restored.sent.length, 0);
    await restored.notifier.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observe returns after durable enqueue without waiting for a slow sender", async () => {
  let release!: () => void;
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    sender: {
      send: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    },
    readThread: async () => ({ thread: thread() }),
  });

  const started = Date.now();
  await notifier.observe("runtime-one", completion(1));
  assert.ok(Date.now() - started < 100);
  const end = Date.now() + 1000;
  while (!release) {
    assert.ok(Date.now() < end, "sender did not start");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  release();
  await notifier.drain();
  await notifier.close();
});

test("filters child threads, failed and interrupted turns", async () => {
  const cases = [
    {
      name: "child",
      eventTurn: { id: "turn-one", status: "completed" },
      meta: { parentThreadId: "root" },
    },
    {
      name: "failed",
      eventTurn: { id: "turn-one", status: "failed" },
      meta: {},
    },
    {
      name: "interrupted",
      eventTurn: { id: "turn-one", status: "interrupted" },
      meta: {},
    },
    {
      name: "history-failed",
      eventTurn: { id: "turn-one", status: "completed" },
      meta: {
        turns: [{ id: "turn-one", status: "failed", items: [finalItem("no")] }],
      },
    },
  ];

  for (const item of cases) {
    const f = fixture();
    f.setReadThread(async () => ({ thread: thread(item.meta) }));
    await f.notifier.observe("runtime-one", completion(1, item.eventTurn));
    await f.notifier.drain();
    assert.equal(f.sent.length, 0, item.name);
    await f.notifier.close();
  }
});

test("fails closed on corrupt durable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-corrupt-"));
  const file = join(root, "notifier.json");
  try {
    await writeFile(file, "{not json", "utf8");
    const errors: unknown[] = [];
    const f = new SessionCodexFeishuNotifier({
      file,
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async () => {
          throw new Error("must not send");
        },
      },
      readThread: async () => ({ thread: thread() }),
      logError: (error) => errors.push(error),
    });

    assert.equal(await f.cursor("runtime-one"), undefined);
    await f.observe("runtime-one", completion(1));
    await f.drain();
    assert.equal(errors.length, 1);
    assert.equal(await readFile(file, "utf8"), "{not json");
    await f.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cursor is isolated by runtime instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-cursor-"));
  const file = join(root, "notifier.json");
  try {
    const f = fixture({ file });
    await f.notifier.observe("runtime-one", completion(4));
    await f.notifier.drain();
    assert.equal(await f.notifier.cursor("runtime-one"), 4);
    assert.equal(await f.notifier.cursor("runtime-two"), undefined);
    await f.notifier.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not invent task completion when the completed turn has no assistant output", async () => {
  const f = fixture();
  f.setReadThread(async () => ({
    thread: thread({
      turns: [{ id: "turn-one", status: "completed", items: [] }],
    }),
  }));

  await f.notifier.observe("runtime-one", completion(1));
  await f.notifier.drain();

  assert.equal(f.sent.length, 0);
  await f.notifier.close();
});

test("keeps pending when readThread fails and later retries with the same completion key", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-read-fail-"));
  const file = join(root, "notifier.json");
  try {
    const f = fixture({ file });
    f.setReadThread(async () => {
      throw new Error("history unavailable");
    });

    await f.notifier.observe("runtime-one", completion(1));
    await f.notifier.drain();
    assert.equal(f.sent.length, 0);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(file, "utf8")).pending),
      ["thread-one:turn-one"],
    );

    f.setReadThread(async () => ({ thread: thread() }));
    await f.notifier.drain();
    assert.deepEqual(
      f.sent.map((event) => event.completionId),
      ["turn-one"],
    );
    await f.notifier.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failing pending notification does not starve later completions", async () => {
  const sent: FeishuCompletionEvent[] = [];
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    sender: {
      send: async (event) => {
        if (event.completionId === "turn-one") {
          throw new Error("first send failed");
        }
        sent.push(event);
      },
    },
    readThread: async (_id, turnId) => ({
      thread: thread({
        turns: [
          {
            id: turnId,
            status: "completed",
            items: [finalItem(`回答 ${turnId}`)],
          },
        ],
      }),
    }),
  });

  await notifier.observe("runtime-one", completion(1));
  await notifier.observe(
    "runtime-one",
    completion(2, { id: "turn-two", status: "completed" }),
  );
  await notifier.drain();

  assert.deepEqual(
    sent.map((event) => [event.completionId, event.summary]),
    [["turn-two", "回答 turn-two"]],
  );
  await notifier.close();
});

test("does not treat phased commentary as a final answer fallback", async () => {
  const f = fixture();
  f.setReadThread(async () => ({
    thread: thread({
      turns: [
        {
          id: "turn-one",
          status: "completed",
          items: [finalItem("过程说明", "commentary")],
        },
      ],
    }),
  }));

  await f.notifier.observe("runtime-one", completion(1));
  await f.notifier.drain();

  assert.equal(f.sent.length, 0);
  await f.notifier.close();
});

test("close during delayed read prevents a late send", async () => {
  const read = deferred<{ thread: ReturnType<typeof thread> }>();
  let reads = 0;
  const sent: FeishuCompletionEvent[] = [];
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
    readThread: async () => {
      reads++;
      return read.promise;
    },
  });

  await notifier.observe("runtime-one", completion(1));
  await waitFor(() => reads === 1);
  await notifier.close();
  read.resolve({ thread: thread() });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 0);
});

test("close during delayed sender keeps pending for the next instance and cannot overwrite its state", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-close-sender-"));
  const file = join(root, "notifier.json");
  try {
    const sentByOld: string[] = [];
    const sentByNew: string[] = [];
    const sender = deferred();
    let oldSenderStarted = false;
    const old = new SessionCodexFeishuNotifier({
      file,
      retryIntervalMs: 20,
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async (event) => {
          oldSenderStarted = true;
          sentByOld.push(event.completionId ?? "");
          await sender.promise;
        },
      },
      readThread: async (_id, turnId) => ({
        thread: thread({
          turns: [
            {
              id: turnId,
              status: "completed",
              items: [finalItem(`回答 ${turnId}`)],
            },
          ],
        }),
      }),
    });

    await old.observe("runtime-one", completion(1));
    await waitFor(() => oldSenderStarted);
    await old.close();

    const restored = new SessionCodexFeishuNotifier({
      file,
      retryIntervalMs: 20,
      settings: { get: () => ({ configured: true, enabled: true }) },
      sender: {
        send: async (event) => {
          sentByNew.push(event.completionId ?? "");
        },
      },
      readThread: async (_id, turnId) => ({
        thread: thread({
          turns: [
            {
              id: turnId,
              status: "completed",
              items: [finalItem(`回答 ${turnId}`)],
            },
          ],
        }),
      }),
    });
    assert.equal(await restored.cursor("runtime-one"), 1);
    await restored.drain();
    await restored.observe(
      "runtime-one",
      completion(2, { id: "turn-two", status: "completed" }),
    );
    await restored.drain();

    sender.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(sentByOld, ["turn-one"]);
    assert.deepEqual(sentByNew, ["turn-one", "turn-two"]);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(file, "utf8")).sent),
      ["thread-one:turn-one", "thread-one:turn-two"],
    );
    await restored.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const unsettled of ["missing", "inProgress"] as const) {
  test(`history ${unsettled} keeps pending until the completed turn becomes visible`, async () => {
    const root = await mkdtemp(join(tmpdir(), "session-feishu-history-retry-"));
    const file = join(root, "notifier.json");
    try {
      const f = fixture({ file });
      let settled = false;
      f.setReadThread(async () => ({
        thread: thread({
          turns: settled
            ? [
                {
                  id: "turn-one",
                  status: "completed",
                  items: [finalItem("最终可见")],
                },
              ]
            : unsettled === "missing"
              ? []
              : [{ id: "turn-one", status: "inProgress", items: [] }],
        }),
      }));

      await f.notifier.observe("runtime-one", completion(1));
      await f.notifier.drain();
      assert.equal(f.sent.length, 0);
      assert.deepEqual(
        Object.keys(JSON.parse(await readFile(file, "utf8")).pending),
        ["thread-one:turn-one"],
      );

      settled = true;
      await f.notifier.drain();
      assert.deepEqual(
        f.sent.map((event) => [event.completionId, event.summary]),
        [["turn-one", "最终可见"]],
      );
      await f.notifier.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("records all delivered card parts against the original native thread before marking sent", async () => {
  const records: any[] = [];
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    sender: {
      send: async () => ({
        messages: [
          { messageId: "om_part1", chatId: "oc_private" },
          { messageId: "om_part2", chatId: "oc_private" },
        ],
      }),
    },
    deliveryRecorder: {
      record: (event, delivery) => {
        records.push({ event, delivery });
      },
    },
    readThread: async () => ({ thread: thread() }),
  });
  try {
    await notifier.observe("runtime", completion(1));
    await waitFor(() => records.length === 1);
    assert.equal(records[0].event.sessionModeThreadId, "thread-one");
    assert.equal(records[0].event.codexThreadId, undefined);
    assert.equal(records[0].delivery.messages.length, 2);
  } finally {
    await notifier.close();
  }
});

test("binding persistence failure keeps a delivered notification pending for retry", async () => {
  let fail = true;
  const delivered: any[] = [];
  const records: any[] = [];
  const notifier = new SessionCodexFeishuNotifier({
    retryIntervalMs: 20,
    settings: { get: () => ({ configured: true, enabled: true }) },
    sender: {
      send: async (event) => {
        delivered.push(event);
        return { messages: [{ messageId: "om_notice", chatId: "oc_private" }] };
      },
    },
    deliveryRecorder: {
      record: (event) => {
        if (fail) throw new Error("disk unavailable");
        records.push(event);
      },
    },
    readThread: async () => ({ thread: thread() }),
  });
  try {
    await notifier.observe("runtime", completion(1));
    await waitFor(() => delivered.length >= 1);
    assert.equal(records.length, 0);
    fail = false;
    await notifier.drain();
    await waitFor(() => records.length === 1);
    assert.equal(delivered[0].completionId, delivered.at(-1).completionId);
    assert.equal(
      delivered[0].sessionModeThreadId,
      delivered.at(-1).sessionModeThreadId,
    );
  } finally {
    await notifier.close();
  }
});

test("an explicitly active thread keeps a completed turn pending until idle", async () => {
  const f = fixture();
  let active = true;
  f.setReadThread(async () => ({
    thread: thread({ status: { type: active ? "active" : "idle" } }),
  }));
  try {
    await f.notifier.observe("runtime", completion(1));
    await f.notifier.drain();
    assert.equal(f.sent.length, 0);
    active = false;
    await f.notifier.drain();
    assert.equal(f.sent.length, 1);
  } finally {
    await f.notifier.close();
  }
});

test("legacy assistant output without phase remains a compatible final answer", async () => {
  const f = fixture();
  f.setReadThread(async () => ({
    thread: thread({
      turns: [
        {
          id: "turn-one",
          status: "completed",
          items: [{ type: "agentMessage", text: "旧版最终回答" }],
        },
      ],
    }),
  }));
  try {
    await f.notifier.observe("runtime", completion(1));
    await f.notifier.drain();
    assert.equal(f.sent[0]?.summary, "旧版最终回答");
  } finally {
    await f.notifier.close();
  }
});

test("the delivery gate keeps pending durable while waiting and sends only after ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-gate-"));
  const file = join(root, "notifier.json");
  let ready = false;
  const targets: unknown[] = [];
  const f = fixture({
    file,
    beforeSend: async (target) => {
      targets.push(target);
      return ready ? "ready" : "wait";
    },
  });
  try {
    await f.notifier.observe("runtime", completion(1));
    await f.notifier.drain();
    assert.equal(f.sent.length, 0);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(file, "utf8")).pending),
      ["thread-one:turn-one"],
    );
    assert.deepEqual(targets, [{ threadId: "thread-one", turnId: "turn-one" }]);
    ready = true;
    await f.notifier.drain();
    assert.equal(f.sent.length, 1);
    assert.equal(targets.length, 3);
  } finally {
    await f.notifier.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a superseded delivery gate durably skips an old completion without retrying", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-feishu-superseded-"));
  const file = join(root, "notifier.json");
  let checks = 0;
  const f = fixture({
    file,
    beforeSend: async () => {
      checks++;
      return "superseded";
    },
  });
  try {
    let reads = 0;
    f.setReadThread(async () => {
      reads++;
      throw new Error("old history unavailable");
    });
    await f.notifier.observe("runtime", completion(1));
    await f.notifier.drain();
    await f.notifier.drain();
    assert.equal(f.sent.length, 0);
    assert.equal(reads, 0);
    assert.equal(checks, 1);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(persisted.pending, {});
    assert.equal(persisted.skipped["thread-one:turn-one"], true);
  } finally {
    await f.notifier.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const delayed of ["history", "gate"] as const) {
  test(`a newer turn start invalidates a completion during delayed ${delayed} and fences replay`, async () => {
    const root = await mkdtemp(join(tmpdir(), "session-feishu-start-race-"));
    const file = join(root, "notifier.json");
    const started = deferred();
    const release = deferred();
    const f = fixture({
      file,
      beforeSend: async () => {
        if (delayed === "gate") {
          started.resolve();
          await release.promise;
        }
        return "ready";
      },
    });
    if (delayed === "history")
      f.setReadThread(async () => {
        started.resolve();
        await release.promise;
        return { thread: thread() };
      });
    try {
      await f.notifier.observe("runtime", completion(1));
      await waitForSignal(started.promise);
      await f.notifier.observe("runtime", {
        seq: 2,
        event: "codex:notification",
        payload: {
          method: "turn/started",
          params: {
            threadId: "thread-one",
            turn: { id: "turn-two", status: "inProgress" },
          },
        },
      });
      release.resolve();
      await f.notifier.drain();
      await f.notifier.observe("runtime", completion(1));
      await f.notifier.drain();
      assert.equal(f.sent.length, 0);
      const persisted = JSON.parse(await readFile(file, "utf8"));
      assert.equal(persisted.cursor, 2);
      assert.deepEqual(persisted.pending, {});
      assert.equal(persisted.skipped["thread-one:turn-one"], true);
    } finally {
      release.resolve();
      await f.notifier.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("closing or disabling while the delivery gate waits prevents a late send", async () => {
  for (const change of ["close", "disable"] as const) {
    const started = deferred();
    const release = deferred();
    const f = fixture({
      beforeSend: async () => {
        started.resolve();
        await release.promise;
        return "ready";
      },
    });
    try {
      await f.notifier.observe("runtime", completion(1));
      await waitForSignal(started.promise);
      if (change === "close") await f.notifier.close();
      else f.setEnabled(false);
      release.resolve();
      await f.notifier.drain();
      assert.equal(f.sent.length, 0, change);
    } finally {
      release.resolve();
      await f.notifier.close();
    }
  }
});

test("a failed send must pass fresh delivery gates on every retry", async () => {
  let ready = true;
  let checks = 0;
  let sends = 0;
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    beforeSend: async () => {
      checks++;
      return ready ? "ready" : "wait";
    },
    sender: {
      send: async () => {
        sends++;
        if (sends === 1) {
          ready = false;
          throw new Error("delivery failed");
        }
      },
    },
    readThread: async () => ({ thread: thread() }),
  });
  try {
    await notifier.observe("runtime", completion(1));
    await notifier.drain();
    assert.equal(sends, 1);
    assert.equal(checks, 2);
    await notifier.drain();
    assert.equal(sends, 1);
    assert.equal(checks, 3);
    ready = true;
    await notifier.drain();
    assert.equal(sends, 2);
    assert.equal(checks, 5);
  } finally {
    await notifier.close();
  }
});

for (const metadataOnly of ["items-missing", "items-not-loaded"] as const) {
  test(`completed history with ${metadataOnly} waits for final output instead of skipping`, async () => {
    const f = fixture();
    let complete = false;
    f.setReadThread(async () => ({
      thread: thread({
        turns: [
          {
            id: "turn-one",
            status: "completed",
            ...(complete
              ? { items: [finalItem("完整回答")] }
              : metadataOnly === "items-missing"
                ? {}
                : { items: [], itemsView: "notLoaded" }),
          },
        ],
      }),
    }));
    try {
      await f.notifier.observe("runtime", completion(1));
      await f.notifier.drain();
      assert.equal(f.sent.length, 0);
      complete = true;
      await f.notifier.drain();
      assert.equal(f.sent[0]?.summary, "完整回答");
    } finally {
      await f.notifier.close();
    }
  });
}

test("a started event queued after the serial barrier still cancels the pending send", async () => {
  let checks = 0;
  let observed: Promise<void> | undefined;
  const sent: FeishuCompletionEvent[] = [];
  const notifier = new SessionCodexFeishuNotifier({
    settings: { get: () => ({ configured: true, enabled: true }) },
    beforeSend: async () => {
      if (++checks === 2) {
        queueMicrotask(() =>
          queueMicrotask(() => {
            observed = notifier.observe("runtime", {
              seq: 2,
              event: "codex:notification",
              payload: {
                method: "turn/started",
                params: { threadId: "thread-one", turn: { id: "turn-two" } },
              },
            });
          }),
        );
      }
      return "ready";
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
    readThread: async () => ({ thread: thread() }),
  });
  try {
    await notifier.observe("runtime", completion(1));
    await notifier.drain();
    await observed;
    assert.equal(sent.length, 0);
  } finally {
    await notifier.close();
  }
});
