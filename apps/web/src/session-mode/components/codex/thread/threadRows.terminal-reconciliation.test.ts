import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
const terminal = (turnId: string, status: string, threadId = "owner") =>
  ({
    method: "turn/completed",
    params: { threadId, turn: { id: turnId, status, items: [], error: null } },
  }) as unknown as ServerNotification;
it("does not leave a stale interruption row after the same turn is reconciled as completed", () => {
  const events = [
    terminal("turn", "interrupted"),
    terminal("turn", "completed"),
  ];
  expect(buildThreadRows(events)).toEqual([]);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    params: { turn: { status: "interrupted" } },
  });
});
it("keeps a true older interruption when a different turn completes", () => {
  const rows = buildThreadRows([
    terminal("old", "interrupted"),
    terminal("new", "completed"),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].item).toMatchObject({
    event: { params: { turn: { id: "old", status: "interrupted" } } },
  });
});
it("deduplicates replayed terminal rows without merging identical turn IDs from different threads", () => {
  const rows = buildThreadRows([
    terminal("turn", "interrupted"),
    terminal("turn", "interrupted"),
    terminal("turn", "failed", "another"),
  ]);
  expect(rows).toHaveLength(2);
});
