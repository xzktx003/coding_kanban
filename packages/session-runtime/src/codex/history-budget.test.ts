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
test("accepted small history retains order, full tool details, and public reasoning summaries", async () => {
  const turns: Json[] = [
    {
      id: "a",
      items: [{ type: "reasoning", summary: ["public"], content: ["private"] }],
    },
    {
      id: "b",
      items: [{ type: "commandExecution", aggregatedOutput: "full tool" }],
    },
  ];
  let page = 0;
  const result = object(
    await readHistory(
      async (method): Promise<Json> =>
        method === "thread/read"
          ? metadata
          : { data: [turns[page++]!], nextCursor: page === 1 ? "next" : null },
      "t",
    ),
  );
  assert.deepEqual(object(result.thread).turns, [
    {
      id: "a",
      items: [{ type: "reasoning", summary: ["public"], content: [] }],
    },
    turns[1],
  ]);
});
