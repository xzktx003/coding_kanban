import { test } from "node:test";
import assert from "node:assert/strict";
import { readHistory, type Rpc } from "./ownership.js";
import { rollback } from "./protocol.js";
import { RpcError } from "../transport/rpc.js";
import { object, type Json } from "../core/json.js";

const metadata = { thread: { id: "t", historyMode: "paginated" } };
test("read-only aggregation has a page budget even when empty pages have fresh cursors", async () => {
  let pages = 0;
  const calls: string[] = [];
  const raw: Rpc = async (method): Promise<Json> => {
    calls.push(method);
    if (method === "thread/read") return metadata;
    return { data: [], nextCursor: String(++pages) };
  };
  await assert.rejects(
    readHistory(raw, "t", { maxPages: 2 }),
    /HISTORY_LIMIT_EXCEEDED.*thread\/turns\/list/,
  );
  assert.equal(pages, 2);
  assert.ok(
    calls.every((x) => ["thread/read", "thread/turns/list"].includes(x)),
  );
});
test("read-only aggregation enforces cumulative bytes and structure count without truncation", async () => {
  const text = "x".repeat(400);
  let pages = 0;
  const raw: Rpc = async (method): Promise<Json> =>
    method === "thread/read"
      ? metadata
      : {
          data: [
            { id: String(++pages), items: [{ type: "agentMessage", text }] },
          ],
          nextCursor: pages === 3 ? null : String(pages),
        };
  await assert.rejects(
    readHistory(raw, "t", { maxBytes: 900 }),
    /HISTORY_LIMIT_EXCEEDED/,
  );
  assert.equal(pages, 2);
  await assert.rejects(
    readHistory(
      async (method, params): Promise<Json> =>
        method === "thread/read"
          ? {
              thread: {
                id: "t",
                historyMode: "legacy",
                ...(object(params).includeTurns
                  ? {
                      turns: Array.from({ length: 8 }, (_, i) => ({
                        id: String(i),
                        items: [],
                      })),
                    }
                  : {}),
              },
            }
          : {},
      "t",
      { maxEntries: 20 },
    ),
    /HISTORY_LIMIT_EXCEEDED/,
  );
});
test("rollback checks history bounds before choosing a native fallback mutation boundary", async () => {
  const calls: string[] = [];
  let pages = 0;
  await assert.rejects(
    rollback(
      { threadId: "t", numTurns: 1 },
      async (method): Promise<Json> => {
        calls.push(method);
        if (method === "thread/rollback")
          throw new RpcError("not found", -32601);
        if (method === "thread/turns/list")
          return { data: [{ id: String(++pages) }], nextCursor: String(pages) };
        throw new Error("must not mutate");
      },
      { maxPages: 2 },
    ),
    /HISTORY_LIMIT_EXCEEDED/,
  );
  assert.deepEqual(calls, [
    "thread/rollback",
    "thread/turns/list",
    "thread/turns/list",
  ]);
});
test("rollback successful mutation followed by oversized history reports success boundary without retry", async () => {
  const calls: string[] = [];
  let pages = 0;
  await assert.rejects(
    rollback(
      { threadId: "t", numTurns: 1, beforeTurnId: "cut" },
      async (method): Promise<Json> => {
        calls.push(method);
        if (method === "thread/rollback")
          throw new RpcError("not found", -32601);
        if (method === "thread/revert")
          return { thread: { id: "t" }, turnsBackwardsCursor: "first" };
        return {
          data: [
            {
              id: String(++pages),
              items: [{ type: "agentMessage", text: "x".repeat(400) }],
            },
          ],
          nextCursor: String(pages),
        };
      },
      { maxBytes: 900 },
    ),
    /历史已回滚.*重新加载失败.*HISTORY_LIMIT_EXCEEDED/,
  );
  assert.equal(calls.filter((x) => x === "thread/revert").length, 1);
  assert.equal(pages, 2);
  let mutations = 0;
  await assert.rejects(
    rollback(
      { threadId: "t", numTurns: 1 },
      async (): Promise<Json> => {
        mutations++;
        return {
          thread: {
            id: "t",
            turns: [{ id: "a", items: [{ text: "x".repeat(800) }] }],
          },
        };
      },
      { maxBytes: 500 },
    ),
    /历史已回滚.*重新加载失败.*HISTORY_LIMIT_EXCEEDED/,
  );
  assert.equal(mutations, 1);
});
/** Serve the shell+items protocol the reader now speaks: turn shells, then bodies. */
function nativeHistory(
  transcript: Array<{ id: string; items: Json[] }>,
  perPage = 1,
) {
  const bodies = new Map(transcript.map((turn) => [turn.id, turn.items]));
  return async (method: string, params: Json): Promise<Json> => {
    if (method === "thread/read") return metadata;
    const request = object(params);
    if (method === "thread/items/list")
      return { data: (bodies.get(String(request.turnId)) ?? []).map((item) => ({ turnId: request.turnId, item })), nextCursor: null };
    const start = request.cursor === null ? 0 : Number(request.cursor);
    const slice = transcript.slice(start, start + perPage);
    const next = start + slice.length;
    return {
      data: slice.map((turn) => ({ id: turn.id })),
      nextCursor: next < transcript.length ? String(next) : null,
    };
  };
}
test("accepted small history retains order, full tool details, and public reasoning summaries", async () => {
  const transcript = [
    {
      id: "a",
      items: [
        { type: "reasoning", summary: ["public"], content: ["private"] },
      ] as Json[],
    },
    {
      id: "b",
      items: [{ type: "commandExecution", aggregatedOutput: "full tool" }] as Json[],
    },
  ];
  const result = object(await readHistory(nativeHistory(transcript), "t"));
  const read = object(result.thread).turns;
  assert.ok(Array.isArray(read));
  assert.deepEqual(
    read.map((entry) => object(entry).id),
    ["a", "b"],
  );
  // Raw reasoning stays hidden; tool bodies stay available to internal readers.
  assert.deepEqual(object(read[0]!).items, [
    { type: "reasoning", summary: ["public"], content: [] },
  ]);
  assert.deepEqual(object(read[1]!).items, [
    { type: "commandExecution", aggregatedOutput: "full tool" },
  ]);
});
test("an oversized turns/list frame retries the same cursor with a smaller page instead of failing the thread", async () => {
  const limits: number[] = [];
  const result = object(
    await readHistory(async (method, params): Promise<Json> => {
      if (method === "thread/read") return metadata;
      if (method === "thread/items/list")
        return { data: [{ turnId: object(params).turnId, item: { type: "agentMessage", text: "x" } }], nextCursor: null };
      const limit = Number(object(params).limit);
      limits.push(limit);
      // The native reply only fits inside the shared RPC frame at small pages.
      if (limit > 25)
        throw new RpcError(
          "DELIVERY_UNKNOWN: RPC frame exceeded byte limit; response rejected, native process retained",
          -32603,
        );
      return object(params).cursor === null
        ? { data: [{ id: "a" }], nextCursor: "next" }
        : { data: [{ id: "b" }], nextCursor: null };
    }, "t"),
  );
  const read = object(result.thread).turns;
  assert.ok(Array.isArray(read));
  assert.deepEqual(
    read.map((entry) => object(entry).id),
    ["a", "b"],
  );
  assert.deepEqual(limits, [100, 50, 25, 25]);
});
test("the native decoder's own oversize wording also halves the page instead of failing the read", async () => {
  const limits: number[] = [];
  const result = object(
    await readHistory(async (method, params): Promise<Json> => {
      if (method === "thread/read") return metadata;
      if (method === "thread/items/list") return { data: [], nextCursor: null };
      const limit = Number(object(params).limit);
      limits.push(limit);
      // Observed verbatim in the official plugin's retry guard.
      if (limit > 12)
        throw new RpcError(
          "Error, decoded message length too large: found 9000000 bytes, the limit is: 4194304 bytes",
          -32603,
        );
      return { data: [{ id: "only" }], nextCursor: null };
    }, "t"),
  );
  const read = object(result.thread).turns;
  assert.ok(Array.isArray(read));
  assert.equal(read.length, 1);
  assert.deepEqual(limits, [100, 50, 25, 12]);
});
test("an oversized items/list frame also halves its page so one huge turn stays readable", async () => {
  const limits: number[] = [];
  const result = object(
    await readHistory(async (method, params): Promise<Json> => {
      if (method === "thread/read") return metadata;
      if (method === "thread/turns/list")
        return { data: [{ id: "huge" }], nextCursor: null };
      const limit = Number(object(params).limit);
      limits.push(limit);
      if (limit > 6)
        throw new RpcError(
          "Error, decoded message length too large: found 9000000 bytes, the limit is: 4194304 bytes",
          -32603,
        );
      return { data: [{ turnId: "huge", item: { type: "agentMessage", text: "body" } }], nextCursor: null };
    }, "t"),
  );
  const read = object(result.thread).turns;
  assert.ok(Array.isArray(read));
  assert.deepEqual(object(read[0]!).items, [
    { type: "agentMessage", text: "body" },
  ]);
  assert.deepEqual(limits, [98, 49, 24, 12, 6]);
});
test("a foreign turn row and a repeated items cursor are rejected instead of silently corrupting a transcript", async () => {
  await assert.rejects(
    readHistory(async (method, params): Promise<Json> => {
      if (method === "thread/read") return metadata;
      if (method === "thread/turns/list")
        return { data: [{ id: "mine" }], nextCursor: null };
      return { data: [{ turnId: "someone-else", item: {} }], nextCursor: null };
    }, "t"),
    /foreign turn/,
  );
  await assert.rejects(
    readHistory(async (method): Promise<Json> => {
      if (method === "thread/read") return metadata;
      if (method === "thread/turns/list")
        return { data: [{ id: "mine" }], nextCursor: null };
      return { data: [], nextCursor: "stuck" };
    }, "t"),
    /Repeated items\/list cursor/,
  );
});
test("an opt-in partial read keeps the pages already read and reports an incomplete boundary", async () => {
  let pages = 0;
  const reader = async (method: string, params: Json): Promise<Json> => {
    if (method === "thread/read") return metadata;
    if (method === "thread/items/list")
      return {
        data: [
          {
            turnId: object(params).turnId,
            item: { type: "agentMessage", text: "x".repeat(400) },
          },
        ],
        nextCursor: null,
      };
    pages += 1;
    return { data: [{ id: `turn-${pages}` }], nextCursor: `cursor-${pages}` };
  };
  // Without the flag the strict contract stands: rollback relies on rejection.
  await assert.rejects(
    readHistory(reader, "t", { maxBytes: 900 }),
    /HISTORY_LIMIT_EXCEEDED/,
  );
  pages = 0;
  const result = object(
    await readHistory(reader, "t", { maxBytes: 900, allowPartial: true }),
  );
  const thread = object(result.thread);
  const read = thread.turns;
  assert.ok(Array.isArray(read));
  // The usable prefix survives; the caller learns why it stops and where to resume.
  assert.deepEqual(
    read.map((entry) => object(entry).id),
    ["turn-1"],
  );
  assert.equal(thread.historyStatus, "incomplete");
  assert.equal(thread.historyIncompleteReason, "budget");
  assert.equal(thread.turnsNextCursor, "cursor-1");
});
