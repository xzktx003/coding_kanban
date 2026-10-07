import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
const event = (method: string, params: unknown) =>
  ({ method, params }) as ServerNotification;
it("keeps one streaming message, commands and warnings while excluding protocol-only events", () => {
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
it("indexes rollback counts and scopes file-summary context to its turn", () => {
  const rows = buildThreadRows([
    event("item/started", {
      turnId: "a",
      item: { type: "userMessage", content: [] },
    }),
    event("turn/diff/updated", { turnId: "a", diff: "diff" }),
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
    rows.find((row) => row.key === "event-3")?.context?.rollbackTurns,
  ).toBe(1);
  const summary = rows.find((row) => row.key === "event-2");
  expect(summary?.context?.events).toHaveLength(3);
  expect(summary?.context?.eventIndex).toBe(2);
  expect(rows.some((row) => row.key === "event-5")).toBe(false);
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
