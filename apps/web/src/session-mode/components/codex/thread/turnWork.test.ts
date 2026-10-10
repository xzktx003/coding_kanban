import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectTurnWork, turnWorkKey } from "./turnWork";

const event = (method: string, params: object) =>
  ({ method, params }) as ServerNotification;
function fixture(status = "completed", owner = "thread", turn = "turn") {
  const item = (id: string, data: object) =>
    event("item/completed", {
      threadId: owner,
      turnId: turn,
      item: { id, ...data },
    });
  return [
    event("turn/started", {
      threadId: owner,
      turn: { id: turn, status: "inProgress", startedAt: 1000, items: [] },
    }),
    event("item/started", {
      threadId: owner,
      turnId: turn,
      item: {
        id: "user",
        type: "userMessage",
        content: [{ type: "text", text: "task" }],
      },
    }),
    item("comment", {
      type: "agentMessage",
      phase: "commentary",
      text: "progress",
    }),
    item("reason", {
      type: "reasoning",
      summary: ["public summary"],
      content: [],
    }),
    item("final", {
      type: "agentMessage",
      phase: "final_answer",
      text: "final report",
    }),
    ...(status === "inProgress"
      ? []
      : [
          event("turn/completed", {
            threadId: owner,
            turn: {
              id: turn,
              status,
              startedAt: 1000,
              completedAt: 1659,
              durationMs: 659000,
              items: [],
            },
          }),
        ]),
  ];
}
const project = (events: ServerNotification[], opened = new Set<string>()) =>
  projectTurnWork(
    groupThreadActivities(buildThreadRows(events), events, {
      threadId: "thread",
      turnId: null,
      running: false,
    }),
    events,
    undefined,
    opened,
  );
it("collapses completed commentary and public reasoning under one duration row, leaving user and final report outside", () => {
  const rows = project(fixture());
  expect(rows).toHaveLength(3);
  expect(rows[1].work).toMatchObject({
    running: false,
    durationMs: 659000,
    expanded: false,
  });
  expect(rows.at(-1)?.item).toMatchObject({
    event: { params: { item: { text: "final report" } } },
  });
});
it("shows the running process below one live duration header", () => {
  const rows = project(fixture("inProgress"));
  expect(rows).toHaveLength(5);
  expect(rows[1].work).toMatchObject({
    running: true,
    startedAtMs: 1000000,
    expanded: true,
  });
});
it("reopens the same process rows with stable message anchors", () => {
  const events = fixture();
  const rows = project(events, new Set([turnWorkKey("thread", "turn")]));
  expect(rows).toHaveLength(5);
  expect(rows[1].work?.expanded).toBe(true);
  expect(rows.filter((r) => !r.work).map((r) => r.key)).toEqual(
    buildThreadRows(events).map((r) => r.key),
  );
});
it("keeps errors, warnings and interactive questions outside a collapsed process", () => {
  const events = fixture("failed");
  events.splice(
    4,
    0,
    event("warning", {
      threadId: "thread",
      turnId: "turn",
      message: "keep visible",
    }),
  );
  events.splice(
    4,
    0,
    event("item/completed", {
      threadId: "thread",
      turnId: "turn",
      item: {
        id: "question",
        type: "agentMessage",
        text: "",
        questions: [{ title: "approve", options: ["yes"] }],
      },
    }),
  );
  const rows = project(events);
  expect(
    rows.some(
      (r) => r.item.kind === "event" && r.item.event.method === "warning",
    ),
  ).toBe(true);
  expect(
    rows.some(
      (r) =>
        r.item.kind === "event" && r.item.event.method === "turn/completed",
    ),
  ).toBe(true);
  expect(
    rows.some(
      (r) =>
        r.item.kind === "event" &&
        (r.item.event.method === "item/started" ||
          r.item.event.method === "item/completed") &&
        r.item.event.params.item.id === "question",
    ),
  ).toBe(true);
});
it("does not invent a zero duration or combine different turns", () => {
  const events = fixture();
  const end = events.at(-1)! as any;
  end.params.turn.durationMs = null;
  end.params.turn.startedAt = null;
  end.params.turn.completedAt = null;
  (events[0] as any).params.turn.startedAt = null;
  const rows = project([...events, ...fixture("completed", "thread", "other")]);
  const groups = rows.filter((r) => r.work).map((r) => r.work!);
  expect(groups).toHaveLength(2);
  expect(groups[0].durationMs).toBeNull();
  expect(groups[1].durationMs).toBe(659000);
});

it("keeps completed history terminal when a stale start or timing snapshot arrives", () => {
  const events = fixture();
  events.push(events[0]);
  const raw = groupThreadActivities(buildThreadRows(events), events, {
    threadId: "thread",
    turnId: null,
    running: false,
  });
  const rows = projectTurnWork(
    raw,
    events,
    {
      turnId: "turn",
      status: "inProgress",
      startedAtMs: 1000000,
      durationMs: null,
    },
    new Set(),
    "thread",
  );
  expect(rows[1].work).toMatchObject({
    running: false,
    expanded: false,
    durationMs: 659000,
  });
});
it("renders the live header even before the first process item arrives", () => {
  const rows = project([fixture("inProgress")[0]]);
  expect(rows).toHaveLength(1);
  expect(rows[0].work).toMatchObject({ running: true, startedAtMs: 1000000 });
});
it("preserves a legacy final report and never folds explicit final-answer deltas", () => {
  const events = fixture();
  const final = events[4] as any;
  delete final.params.item.phase;
  expect(project(events).at(-1)?.key).toBe(buildThreadRows(events).at(-1)?.key);
  final.params.item.phase = "final_answer";
  final.method = "item/started";
  events.splice(
    5,
    0,
    event("item/agentMessage/delta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "final",
      delta: "report chunk",
    }),
  );
  const rows = project(events);
  expect(rows[1].work?.processKeys.size).toBe(2);
  expect(rows.at(-1)?.item).toMatchObject({
    event: { method: "item/agentMessage/delta" },
  });
});
it("folds streamed plans, terminal input, hooks and child-agent process records with the turn", () => {
  const events = fixture();
  const params = { threadId: "thread", turnId: "turn" };
  events.splice(
    4,
    0,
    event("turn/plan/updated", {
      ...params,
      explanation: "progress",
      plan: [{ step: "check", status: "completed" }],
    }),
    event("item/plan/delta", {
      ...params,
      itemId: "plan-stream",
      delta: "public plan",
    }),
    event("item/commandExecution/terminalInteraction", {
      ...params,
      itemId: "command",
      stdin: "enter",
    }),
    event("item/completed", {
      ...params,
      item: {
        id: "hook",
        type: "hookPrompt",
        fragments: [{ text: "public hook", hookRunId: "hook-run" }],
      },
    }),
    event("item/completed", {
      ...params,
      item: { id: "child", type: "collabAgentToolCall" },
    }),
    event("item/completed", {
      ...params,
      item: { id: "child-progress", type: "subAgentActivity" },
    }),
  );
  const raw = buildThreadRows(events);
  const rows = projectTurnWork(raw, events, undefined, new Set(), "thread");
  expect(rows).toHaveLength(3);
  expect(rows[1].work?.processKeys.size).toBe(raw.length - 2);
  const opened = projectTurnWork(
    raw,
    events,
    undefined,
    new Set([turnWorkKey("thread", "turn")]),
    "thread",
  );
  expect(opened.filter((row) => !row.work).map((row) => row.key)).toEqual(
    raw.map((row) => row.key),
  );
});
