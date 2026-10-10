import { expect, it } from "vitest";
import { buildThreadRows } from "./threadRows";
it("keeps hook runs as metadata while rendering public hook feedback and unknown native diagnostics", () => {
  const event = (method: string, params: object) =>
    ({ method, params }) as never;
  const rows = buildThreadRows([
    event("hook/started", {
      threadId: "owner",
      turnId: "turn",
      run: { id: "run", status: "running", entries: [] },
    }),
    event("item/started", {
      threadId: "owner",
      turnId: "turn",
      item: {
        type: "hookPrompt",
        id: "hook-feedback",
        fragments: [{ text: "Public feedback", hookRunId: "run" }],
      },
    }),
    event("hook/completed", {
      threadId: "owner",
      turnId: "turn",
      run: { id: "run", status: "blocked", entries: [] },
    }),
    event("item/started", {
      threadId: "owner",
      turnId: "turn",
      item: { type: "unknownTool", id: "future", data: 42 },
    }),
  ]);
  expect(rows).toHaveLength(2);
  expect(
    rows.map((row) =>
      row.item.kind === "event" ? row.item.event.method : row.item.kind,
    ),
  ).toEqual(["item/started", "item/started"]);
});
