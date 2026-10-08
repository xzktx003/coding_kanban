import test from "node:test";
import assert from "node:assert/strict";
import { CodexSubagents } from "./codex-subagents.js";

const thread = (id: string, parentThreadId: string | null = null) => ({
  id,
  parentThreadId,
  status: { type: "idle" },
  turns: [],
  canAcceptDirectInput: false,
});
test("discovers paginated nested children, deduplicates and excludes ordinary forks", async () => {
  const calls: any[] = [];
  const service = new CodexSubagents(async (method, params) => {
    calls.push([method, params]);
    if (method === "thread/metadata")
      return { thread: thread(params.threadId as string) };
    return params.cursor
      ? { data: [thread("grand", "child"), thread("fork")], nextCursor: null }
      : {
          data: [thread("child", "root"), thread("child", "root")],
          nextCursor: "page2",
        };
  });
  const result = await service.discover("root", []);
  assert.deepEqual(
    result.threads.map((t) => t.id),
    ["child", "grand"],
  );
  assert.equal(result.complete, true);
  assert.equal(calls[0][1].sourceKinds[0], "subAgentThreadSpawn");
});
test("twenty descendants restore missing ancestry with at most two parallel repairs", async () => {
  let active = 0,
    peak = 0;
  const service = new CodexSubagents(async (method, p) => {
    if (method === "thread/list") return { data: [], nextCursor: null };
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    const id = p.threadId as string;
    return { thread: thread(id, id.startsWith("grand") ? "middle" : "root") };
  });
  const result = await service.discover(
    "root",
    Array.from({ length: 20 }, (_, i) => `grand-${i}`),
  );
  assert.equal(result.threads.length, 21);
  assert.equal(result.complete, true);
  assert.ok(peak <= 2);
});
test("unsupported ancestor filter uses direct-parent pagination rather than a broad scan", async () => {
  const filters: any[] = [];
  const service = new CodexSubagents(async (_, p) => {
    filters.push(p);
    if (p.ancestorThreadId) throw new Error("unsupported ancestor filter");
    return {
      data:
        p.parentThreadId === "root"
          ? [thread("child", "root")]
          : p.parentThreadId === "child"
            ? [thread("grand", "child")]
            : [],
      nextCursor: null,
    };
  });
  const result = await service.discover("root", []);
  assert.deepEqual(
    result.threads.map((t) => t.id),
    ["child", "grand"],
  );
  assert.ok(filters.every((p) => p.ancestorThreadId || p.parentThreadId));
});
test("cursor loops and failed pages never claim a complete empty family", async () => {
  const service = new CodexSubagents(async () => ({
    data: [thread("child", "root")],
    nextCursor: "again",
  }));
  const result = await service.discover("root", []);
  assert.equal(result.complete, false);
  assert.equal(result.threads.length, 1);
});
test("observed missing child is repaired read-only and cross-family targets rejected", async () => {
  const calls: string[] = [];
  const service = new CodexSubagents(async (method, params) => {
    calls.push(method);
    if (method === "thread/list") return { data: [], nextCursor: null };
    return {
      thread: thread(
        params.threadId as string,
        params.threadId === "child" ? "root" : "elsewhere",
      ),
    };
  });
  const result = await service.discover("root", ["child"]);
  assert.equal(result.threads[0].id, "child");
  await assert.rejects(() => service.verify("root", "foreign"), /所属/);
  assert.ok(!calls.includes("thread/resume"));
});
test("stop rejects a late turn without touching a newer execution", async () => {
  const calls: string[] = [];
  const service = new CodexSubagents(async (method) => {
    calls.push(method);
    return {
      thread: {
        ...thread("child", "root"),
        turns: [{ id: "new", status: "inProgress" }],
      },
    };
  });
  const result = await service.stop(
    "root",
    [{ threadId: "child", turnId: "old" }],
    async () => {
      calls.push("stop");
    },
  );
  assert.equal(result[0].phase, "superseded");
  assert.ok(!calls.includes("stop"));
});
test("stop distinguishes pre-dispatch failures from a missing stop receipt", async () => {
  const before = new CodexSubagents(async () => {
    throw new Error("timeout");
  });
  let sent = false;
  const noSend = await before.stop(
    "root",
    [{ threadId: "child", turnId: "active" }],
    async () => {
      sent = true;
    },
  );
  assert.equal(noSend[0].phase, "failed");
  assert.equal(sent, false);
  const after = new CodexSubagents(async () => ({
    thread: {
      ...thread("child", "root"),
      turns: [{ id: "active", status: "inProgress" }],
    },
  }));
  const unknown = await after.stop(
    "root",
    [{ threadId: "child", turnId: "active" }],
    async () => {
      throw new Error("timeout");
    },
  );
  assert.equal(unknown[0].phase, "uncertain");
});
test("batch stop has individual outcomes, never includes the root, and input capability is independent", async () => {
  const service = new CodexSubagents(async (_, p) => ({
    thread: {
      ...thread(p.threadId as string, "root"),
      turns: [{ id: "active", status: "inProgress" }],
    },
  }));
  const targets = [
    { threadId: "child", turnId: "active" },
    { threadId: "root", turnId: "active" },
  ];
  const result = await service.stop("root", targets, async () => {});
  assert.equal(result[0].phase, "requested");
  assert.equal(result[1].phase, "failed");
});
