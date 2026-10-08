import { expect, it } from "vitest";
import { buildThreadRows } from "./threadRows";
const user = (
  method: string,
  id = "item",
  clientId: string | null = "submission",
  turnId = "turn",
) =>
  ({
    method,
    params: {
      threadId: "thread",
      turnId,
      item: {
        type: "userMessage",
        id,
        clientId,
        content: [{ type: "text", text: "same message", text_elements: [] }],
      },
    },
  }) as any;
it("renders a completed user message even if its started event was missed", () => {
  const rows = buildThreadRows([user("item/completed")]);
  expect(rows).toHaveLength(1);
  expect(rows[0].item.kind === "event" && rows[0].item.event.method).toBe(
    "item/started",
  );
  expect(rows[0].context?.rollbackTurns).toBe(1);
});
it("renders one user message for repeated, reversed and overlapping history events", () => {
  const rows = buildThreadRows([
    user("item/completed"),
    user("item/started"),
    user("item/completed"),
    user("item/started"),
  ]);
  expect(rows).toHaveLength(1);
});
it("keeps identical text sent with different submission identities and stable row keys", () => {
  const a = user("item/started"),
    b = user("item/started", "second", "second-submission", "second-turn");
  expect(buildThreadRows([a, b])).toHaveLength(2);
  expect(buildThreadRows([a, b])[0].context?.rollbackTurns).toBe(2);
  expect(buildThreadRows([a])[0].key).toBe(
    buildThreadRows([
      { method: "thread/started", params: { thread: { id: "thread" } } } as any,
      a,
    ])[0].key,
  );
});
it("recovers the user message from a completed turn and deduplicates it against item notifications", () => {
  const started = user("item/started");
  const turn = {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "completed", items: [started.params.item] },
    },
  } as any;
  expect(buildThreadRows([turn])).toHaveLength(1);
  expect(buildThreadRows([started, turn])).toHaveLength(1);
});
it("links started and completed notifications when only one includes the submission id", () => {
  expect(
    buildThreadRows([
      user("item/started", "item", null),
      user("item/completed"),
    ]),
  ).toHaveLength(1);
});
