import { expect, it } from "vitest";
import { buildThreadRows } from "./threadRows";

it("retains failed turns without file changes so persisted errors can be rendered", () => {
  const failure: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "t",
        status: "failed",
        items: [],
        error: { message: "invalid input" },
      },
    },
  };
  expect(buildThreadRows([failure]).map((row) => row.item.kind)).toEqual([
    "event",
  ]);
});
it("still omits successful turns with no visible content", () => {
  const completion: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: { id: "t", status: "completed", items: [], error: null },
    },
  };
  expect(buildThreadRows([completion])).toEqual([]);
});
