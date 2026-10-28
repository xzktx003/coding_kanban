import { expect, test } from "vitest";
import { buildToolResultsMap } from "./toolResults";
import type { CCMessage } from "../../types/messages";

// Regression: the aligned cards summarize their own result (Grep's line count,
// Edit's line delta, plan mode's approval). The existing inlineErrors map only
// collected `is_error` results, so successful results never reached a card and
// those summaries stayed empty. Caught by the browser acceptance run.

const assistant = (id: string, toolUseId: string, name: string): CCMessage =>
  ({
    type: "assistant",
    uuid: id,
    message: {
      id,
      content: [{ type: "tool_use", id: toolUseId, name, input: {} }],
    },
  }) as CCMessage;

const results = (
  blocks: Array<{ tool_use_id: string; content: string; is_error?: boolean }>,
): CCMessage =>
  ({
    type: "user",
    content: blocks.map((block) => ({ type: "tool_result", ...block })),
  }) as CCMessage;

test("successful tool results are collected, not only errors", () => {
  const map = buildToolResultsMap([
    assistant("m1", "t-grep", "Grep"),
    results([{ tool_use_id: "t-grep", content: "a.ts:1\nb.ts:2" }]),
  ]);
  expect(map[0]?.["t-grep"]?.content).toBe("a.ts:1\nb.ts:2");
});

test("error results are still collected", () => {
  const map = buildToolResultsMap([
    assistant("m1", "t-edit", "Edit"),
    results([
      { tool_use_id: "t-edit", content: "not found", is_error: true },
    ]),
  ]);
  expect(map[0]?.["t-edit"]?.is_error).toBe(true);
});

test("results are keyed per assistant message index", () => {
  const map = buildToolResultsMap([
    assistant("m1", "t-a", "Grep"),
    results([{ tool_use_id: "t-a", content: "first" }]),
    assistant("m2", "t-b", "Glob"),
    results([{ tool_use_id: "t-b", content: "second" }]),
  ]);
  expect(map[0]?.["t-a"]?.content).toBe("first");
  expect(map[2]?.["t-b"]?.content).toBe("second");
  // A message's results must not leak into another message's map.
  expect(map[0]?.["t-b"]).toBeUndefined();
  expect(map[2]?.["t-a"]).toBeUndefined();
});

test("a pending tool call has no entry yet", () => {
  // No following user message means the tools are still running.
  const map = buildToolResultsMap([assistant("m1", "t-x", "Bash")]);
  expect(map[0]).toBeUndefined();
});

test("intervening stream events do not hide the results", () => {
  const map = buildToolResultsMap([
    assistant("m1", "t-x", "Grep"),
    { type: "stream_event", uuid: "s", session_id: "s", event: {} } as CCMessage,
    results([{ tool_use_id: "t-x", content: "found" }]),
  ]);
  expect(map[0]?.["t-x"]?.content).toBe("found");
});

test("several results from one message are all collected", () => {
  const map = buildToolResultsMap([
    {
      type: "assistant",
      uuid: "m1",
      message: {
        id: "m1",
        content: [
          { type: "tool_use", id: "t-1", name: "Grep", input: {} },
          { type: "tool_use", id: "t-2", name: "Glob", input: {} },
        ],
      },
    } as CCMessage,
    results([
      { tool_use_id: "t-1", content: "grep out" },
      { tool_use_id: "t-2", content: "glob out" },
    ]),
  ]);
  expect(map[0]?.["t-1"]?.content).toBe("grep out");
  expect(map[0]?.["t-2"]?.content).toBe("glob out");
});
