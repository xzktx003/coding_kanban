import { expect, it } from "vitest";
import { findTurnRowIndex } from "./turnNavigation";
it("finds the first actual visible row for a linked turn including command-only history", () => {
  const rows = [
    {
      item: {
        kind: "event",
        event: { params: { threadId: "other", turnId: "turn" } },
      },
    },
    {
      item: {
        kind: "cmdGroup",
        actionSources: [{ threadId: "owner", turnId: "turn" }],
      },
    },
    {
      item: {
        kind: "event",
        event: { params: { threadId: "owner", turnId: "turn" } },
      },
    },
  ] as never;
  expect(findTurnRowIndex(rows, "owner", "turn")).toBe(1);
  expect(findTurnRowIndex(rows, "owner", "missing")).toBe(-1);
});
