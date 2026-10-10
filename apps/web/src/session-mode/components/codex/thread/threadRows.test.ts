import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { withoutToolTranscriptEvents } from "@session/services/codexTranscriptVisibility";
it("keeps one structured question instead of its streamed text or duplicate snapshot", () => {
  const item = {
    type: "agentMessage",
    id: "q",
    text: "",
    questions: [{ title: "选择", options: ["A"] }],
  };
  const rows = buildThreadRows([
    {
      method: "item/agentMessage/delta",
      params: { threadId: "t", turnId: "turn", itemId: "q", delta: "选择" },
    },
    {
      method: "item/completed",
      params: { threadId: "t", turnId: "turn", item },
    },
    {
      method: "turn/completed",
      params: {
        threadId: "t",
        turn: { id: "turn", status: "completed", items: [item] },
      },
    },
  ] as any);
  expect(rows).toHaveLength(1);
  expect(rows[0].item.kind === "event" && rows[0].item.event.method).toBe(
    "item/completed",
  );
});
const event = (method: string, params: unknown) =>
  ({ method, params }) as ServerNotification;
it("keeps a message reading anchor stable when older history is prepended", () => {
  const message = event("item/completed", {
    threadId: "t",
    turnId: "last",
    item: { type: "agentMessage", id: "a", text: "answer" },
  });
  const old = event("item/completed", {
    threadId: "t",
    turnId: "old",
    item: { type: "agentMessage", id: "old", text: "older" },
  });
  expect(buildThreadRows([old, message]).at(-1)?.key).toBe(
    buildThreadRows([message])[0].key,
  );
});
it("keeps one streaming message and warnings while excluding protocol-only events", () => {
  const rows = buildThreadRows([
    event("thread/status/changed", {}),
    event("item/started", { item: { type: "agentMessage", id: "a" } }),
    event("item/agentMessage/delta", { itemId: "a", delta: "hello" }),
    event("item/completed", {
      item: { type: "agentMessage", id: "a", text: "hello" },
    }),
    event("warning", { message: "warning" }),
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0].item.kind).toBe("event");
  expect(rows[1].key).toBe("event-4");
});
it("indexes rollback counts and scopes retained native diff summaries to their turn", () => {
  const rows = buildThreadRows([
    event("item/started", {
      turnId: "a",
      item: { type: "userMessage", content: [] },
    }),
    event("turn/diff/updated", {
      turnId: "a",
      diff: "diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
    }),
    event("turn/completed", {
      turn: { id: "a", status: "completed", items: [] },
    }),
    event("item/started", {
      turnId: "b",
      item: { type: "userMessage", content: [] },
    }),
    event("item/completed", {
      turnId: "b",
      item: { type: "agentMessage", id: "b", text: "answer" },
    }),
    event("turn/completed", {
      turn: { id: "b", status: "completed", items: [] },
    }),
  ]);
  expect(rows[0].context?.rollbackTurns).toBe(2);
  expect(
    rows.find(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "item/started" &&
        row.item.event.params.turnId === "b",
    )?.context?.rollbackTurns,
  ).toBe(1);
  expect(
    rows.filter(
      (row) =>
        row.item.kind === "event" && row.item.event.method === "turn/completed",
    ),
  ).toHaveLength(1);
  const summary = rows.find(
    (row) =>
      row.item.kind === "event" && row.item.event.method === "turn/completed",
  );
  expect(summary?.context?.events).toHaveLength(3);
  expect(summary?.context?.eventIndex).toBe(2);
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "turn/diff/updated",
    ),
  ).toBe(false);
});

it("keeps projected tool-only diff cursors out of padded rows and empty file summaries", () => {
  const events = withoutToolTranscriptEvents([
    event("turn/diff/updated", {
      threadId: "owner",
      turnId: "turn",
      diff: "private patch body",
    }),
    event("item/commandExecution/terminalInteraction", {
      threadId: "owner",
      turnId: "turn",
      itemId: "cmd",
      stdin: "private terminal input",
    }),
    event("turn/completed", {
      threadId: "owner",
      turn: { id: "turn", status: "completed", items: [] },
    }),
  ]);
  expect(buildThreadRows(events)).toEqual([]);
  expect(
    buildThreadRows(events).filter(
      (row) =>
        row.item.kind === "event" && row.item.event.method === "turn/completed",
    ),
  ).toHaveLength(0);
  expect(JSON.stringify(events)).not.toContain("private patch body");
  expect(JSON.stringify(events)).not.toContain("private terminal input");
});
it("does not turn a rename notification into a chat message", () => {
  expect(
    buildThreadRows([
      event("thread/name/updated", {
        threadId: "thread",
        threadName: "New title",
      }),
    ]),
  ).toEqual([]);
});
it("hides hook lifecycle notifications while keeping useful warnings", () => {
  const rows = buildThreadRows([
    event("hook/started", {
      threadId: "thread",
      turnId: "turn",
      run: { id: "hook", entries: [] },
    }),
    event("hook/completed", {
      threadId: "thread",
      turnId: "turn",
      run: { id: "hook", entries: [] },
    }),
    event("item/completed", {
      threadId: "thread",
      turnId: "turn",
      item: { type: "sleep", id: "sleep", durationMs: 1000 },
    }),
    event("warning", { message: "A useful warning" }),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].item.kind).toBe("event");
  expect(rows[0].item.kind === "event" && rows[0].item.event.method).toBe(
    "warning",
  );
});
