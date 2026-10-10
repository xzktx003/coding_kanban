import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import type { Turn } from "@session/bindings/v2";
import { buildThreadRows } from "./threadRows";
import { projectTurnWork } from "./turnWork";

it("indexes 10,000 native history events with row visits bounded independently of the turn count", () => {
  const turnCount = 2_500;
  const events: ServerNotification[] = [];
  for (let index = 0; index < turnCount; index++) {
    const threadId = `thread-${index % 2}`;
    const turnId = `turn-${index}`;
    const turn: Turn = {
      id: turnId,
      status: "inProgress",
      items: [],
      itemsView: "full",
      error: null,
      startedAt: index,
      completedAt: null,
      durationMs: null,
    };
    events.push({ method: "turn/started", params: { threadId, turn } });
    for (const phase of ["commentary", "final_answer"] as const) {
      events.push({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          completedAtMs: index * 1_000 + 500,
          item: {
            type: "agentMessage",
            id: `${turnId}-${phase}`,
            text: `${phase} ${index}`,
            phase,
            memoryCitation: null,
          },
        },
      });
    }
    events.push({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          ...turn,
          status: "completed",
          completedAt: index + 1,
          durationMs: 1_000,
        },
      },
    });
  }
  const rows = buildThreadRows(events);
  let visits = 0;
  const observed = rows.map((row) => ({
    ...row,
    get item() {
      visits++;
      return row.item;
    },
  }));
  const result = projectTurnWork(observed, events, undefined, new Set());
  const projectionVisits = visits;

  expect(events).toHaveLength(10_000);
  expect(rows).toHaveLength(turnCount * 2);
  // A history update or reading-anchor change must not scan every row again
  // for every turn. Count accesses rather than depending on shared-host speed.
  expect(projectionVisits).toBeLessThanOrEqual(rows.length * 24);
  expect(result).toHaveLength(turnCount * 2);
  const headers = result.filter((row) => row.work);
  expect(headers).toHaveLength(turnCount);
  expect(
    headers.every(
      (row) =>
        row.work?.processKeys.size === 1 &&
        row.work.expanded === false &&
        row.work.durationMs === 1_000,
    ),
  ).toBe(true);
  expect(new Set(headers.map((row) => row.work?.threadId))).toEqual(
    new Set(["thread-0", "thread-1"]),
  );
  expect(
    result.filter(
      (row) =>
        !row.work &&
        row.item.kind === "event" &&
        row.item.event.method === "item/completed" &&
        row.item.event.params.item.type === "agentMessage" &&
        row.item.event.params.item.phase === "final_answer",
    ),
  ).toHaveLength(turnCount);
});
