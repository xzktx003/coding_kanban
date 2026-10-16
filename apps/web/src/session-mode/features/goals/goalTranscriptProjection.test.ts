import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { groupThreadActivities } from "@session/components/codex/thread/activityRows";
import {
  projectTurnWork,
  type TranscriptWorkRow,
} from "@session/components/codex/thread/turnWork";
import { projectWorkflowRows } from "@session/components/codex/thread/projectWorkflowRows";
import { GoalTranscriptStore } from "./goalTranscript";
import { projectGoalTranscriptSlots } from "./goalTranscriptProjection";

const started = (id: string): ServerNotification => ({
  method: "turn/started",
  params: {
    threadId: "owner",
    turn: {
      id,
      status: "inProgress",
      items: [],
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      error: null,
      itemsView: "full",
    },
  },
});
const completed = (id: string): ServerNotification => ({
  method: "turn/completed",
  params: {
    threadId: "owner",
    turn: {
      id,
      status: "completed",
      items: [],
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      error: null,
      itemsView: "full",
    },
  },
});
const user = (turnId: string, text: string): ServerNotification => ({
  method: "item/started",
  params: {
    threadId: "owner",
    turnId,
    startedAtMs: 1000,
    item: {
      id: `user-${turnId}`,
      type: "userMessage",
      content: [{ type: "text", text, text_elements: [] }],
      clientId: null,
    },
  },
});
const rows = (events: ServerNotification[]) =>
  projectTurnWork(
    groupThreadActivities(buildThreadRows(events), events),
    events,
    undefined,
    new Set(),
    "owner",
  );
const announcement = (afterTurnId: string | null) => {
  const store = new GoalTranscriptStore();
  store.append({
    threadId: "owner",
    goal: { threadId: "owner", objective: "Ship the result", updatedAt: 10 },
    source: "existing-thread-goal-set",
    afterTurnId,
  });
  return store.getSnapshot("owner");
};

it("places the synthetic /goal after its captured real turn and before later native turns without modifying native rows", () => {
  const events = [
    started("before"),
    user("before", "Original request"),
    completed("before"),
    started("after"),
    user("after", "Later request"),
    completed("after"),
  ];
  const nativeRows = rows(events);
  const original = [...nativeRows];
  const workflow = projectWorkflowRows("owner", nativeRows, events);
  const slots = projectGoalTranscriptSlots(
    "owner",
    nativeRows,
    announcement("before"),
    events,
  );
  expect(slots.before).toEqual([]);
  expect(
    slots.afterRow.get(nativeRows[0].key)?.map((entry) => entry.text),
  ).toEqual(["/goal Ship the result"]);
  expect(slots.afterRow.has(nativeRows[1].key)).toBe(false);
  expect(nativeRows).toEqual(original);
  nativeRows.forEach((row, index) => expect(row).toBe(original[index]));
  expect(projectWorkflowRows("owner", nativeRows, events)).toEqual(workflow);
  expect(nativeRows[0].context?.rollbackTurns).toBe(2);
});

it("an empty native transcript and a null native anchor place Goal before the first genuine turn", () => {
  const a = announcement(null);
  expect(projectGoalTranscriptSlots("owner", [], a, []).before).toBe(a);
  const events = [started("next"), user("next", "Actual prompt")];
  const slots = projectGoalTranscriptSlots("owner", rows(events), a, events);
  expect(slots.before).toEqual(a);
  expect(slots.afterRow.size).toBe(0);
});

it("a hidden native turn uses metadata ordering; an unavailable nonempty history does not invent an anchor", () => {
  const events = [
    started("before"),
    user("before", "Original"),
    completed("before"),
    started("hidden"),
    completed("hidden"),
    started("after"),
    user("after", "Later"),
    completed("after"),
  ];
  const nativeRows = rows(events);
  const slots = projectGoalTranscriptSlots(
    "owner",
    nativeRows,
    announcement("hidden"),
    events,
  );
  expect(slots.afterRow.get(nativeRows[0].key)).toHaveLength(1);
  const unknown = projectGoalTranscriptSlots(
    "owner",
    nativeRows,
    announcement("missing"),
    events,
  );
  expect(unknown.before).toEqual([]);
  expect(unknown.afterRow.size).toBe(0);
  expect(unknown.unplaced).toHaveLength(1);
});

it("does not dedupe a real native /goal user message by matching text or alter its native turn identity", () => {
  const events = [
    started("real"),
    user("real", "/goal Ship the result"),
    completed("real"),
  ];
  const nativeRows = rows(events);
  const slots = projectGoalTranscriptSlots(
    "owner",
    nativeRows,
    announcement("real"),
    events,
  );
  expect(nativeRows).toHaveLength(1);
  expect(slots.afterRow.get(nativeRows[0].key)).toHaveLength(1);
  expect(
    nativeRows[0].item.kind === "event" &&
      "turnId" in nativeRows[0].item.event.params &&
      nativeRows[0].item.event.params.turnId,
  ).toBe("real");
  expect(
    projectGoalTranscriptSlots(
      "other",
      nativeRows,
      announcement("real"),
      events,
    ).afterRow.size,
  ).toBe(0);
});

it("slot indexing reads only identities and never scans native user, assistant or tool bodies", () => {
  const item = {
    id: "huge",
    type: "agentMessage",
    get text(): string {
      throw new Error("must not read native body");
    },
  };
  const event = {
    method: "item/completed",
    params: { threadId: "owner", turnId: "native", item },
  } as unknown as ServerNotification;
  const nativeRows = [
    { key: "native-row", item: { kind: "event", event, index: 0 } },
  ] as TranscriptWorkRow[];
  const lifecycle = {
    method: "turn/completed",
    params: {
      threadId: "owner",
      turn: {
        id: "native",
        get items(): never {
          throw new Error("must not scan native items");
        },
      },
    },
  } as unknown as ServerNotification;
  expect(
    projectGoalTranscriptSlots("owner", nativeRows, announcement("native"), [
      event,
      lifecycle,
    ]).afterRow.get("native-row"),
  ).toHaveLength(1);
});

it("a running turn keeps Goal after its native work header and subsequent items of that same turn", () => {
  const events = [started("running"), user("running", "Current prompt")];
  const a = announcement("running");
  const nativeRows = rows(events);
  expect(nativeRows.at(-1)?.work?.turnId).toBe("running");
  expect(
    projectGoalTranscriptSlots("owner", nativeRows, a, events).afterRow.get(
      nativeRows.at(-1)!.key,
    ),
  ).toBeTruthy();
  const reply = {
    method: "item/completed",
    params: {
      threadId: "owner",
      turnId: "running",
      completedAtMs: 2000,
      item: {
        type: "agentMessage",
        id: "reply",
        text: "Later old-turn update",
        phase: "final_answer",
        memoryCitation: null,
      },
    },
  } as ServerNotification;
  const following = [...events, reply];
  const followingRows = rows(following);
  expect(
    projectGoalTranscriptSlots(
      "owner",
      followingRows,
      a,
      following,
    ).afterRow.get(followingRows.at(-1)!.key),
  ).toBeTruthy();
});
