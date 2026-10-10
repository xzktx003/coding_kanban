import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";

const completed = (id: string, item: object) =>
  ({
    method: "item/completed",
    params: { threadId: "thread", turnId: "turn", item: { id, ...item } },
  }) as ServerNotification;

it.each([{ summary: [] }, { summary: [""] }, { summary: ["  \n  "] }])(
  "does not allocate blank virtual rows for non-visible summaries: $summary",
  ({ summary }) => {
    const first = completed("first", { type: "agentMessage", text: "first" });
    const last = completed("last", { type: "agentMessage", text: "last" });
    const hidden = Array.from({ length: 40 }, (_, i) =>
      completed(`reason-${i}`, {
        type: "reasoning",
        summary,
        content: ["private content stays hidden"],
      }),
    );
    const rows = buildThreadRows([first, ...hidden, last]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key)).toEqual(
      buildThreadRows([first, last]).map((row) => row.key),
    );
  },
);

it("keeps public reasoning summaries", () => {
  expect(
    buildThreadRows([
      completed("visible", {
        type: "reasoning",
        summary: ["Public summary"],
        content: [],
      }),
    ]),
  ).toHaveLength(1);
});
