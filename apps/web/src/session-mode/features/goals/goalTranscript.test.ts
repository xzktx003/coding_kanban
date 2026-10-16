import { beforeEach, expect, it, vi } from "vitest";
import {
  GoalTranscriptStore,
  GOAL_TRANSCRIPT_LIMITS,
  appendGoalAnnouncement,
  clearGoalAnnouncements,
  getGoalAnnouncements,
} from "./goalTranscript";
import {
  expiredCodexTranscripts,
  forgetCodexTranscript,
  markCodexTranscriptDormant,
  retainCodexTranscript,
} from "@session/services/codexTranscriptActivity";

const goal = {
  threadId: "owner",
  objective: "Ship the result",
  updatedAt: 100,
};
const append = (
  store: GoalTranscriptStore,
  changes: Record<string, unknown> = {},
) =>
  store.append({
    threadId: "owner",
    goal,
    source: "existing-thread-goal-set",
    afterTurnId: "native-before",
    ...changes,
  } as never);
beforeEach(() => {
  clearGoalAnnouncements();
  forgetCodexTranscript("goal-release-owner");
});

it("Bbn/Bjt expose a completed local /goal announcement without a native turn or protocol fields", () => {
  const store = new GoalTranscriptStore();
  expect(append(store)).toBe(true);
  const announcement = store.getSnapshot("owner")[0];
  expect(announcement).toMatchObject({
    kind: "goal-announcement",
    threadId: "owner",
    text: "/goal Ship the result",
    status: "completed",
    nativeTurnId: null,
    goalUpdatedAt: 100,
    afterTurnId: "native-before",
  });
  expect(announcement).not.toHaveProperty("params");
  expect(announcement).not.toHaveProperty("turnId");
  expect(announcement).not.toHaveProperty("method");
  expect(announcement).not.toHaveProperty("rollbackTurns");
});

it("Vbn deduplicates only the same latest synthetic turn, while a real new turn and A→B→A remain distinct", () => {
  const store = new GoalTranscriptStore();
  const notify = vi.fn();
  store.subscribe(notify);
  expect(append(store)).toBe(true);
  const first = store.getSnapshot("owner");
  expect(append(store)).toBe(false);
  expect(store.getSnapshot("owner")).toBe(first);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(append(store, { afterTurnId: "native-after" })).toBe(true);
  expect(
    append(store, {
      afterTurnId: "native-after",
      goal: { ...goal, objective: "Other objective" },
    }),
  ).toBe(true);
  expect(append(store, { afterTurnId: "native-after" })).toBe(true);
  expect(
    append(store, {
      afterTurnId: "native-after",
      goal: { ...goal, updatedAt: 101 },
    }),
  ).toBe(true);
  const entries = store.getSnapshot("owner");
  expect(entries.map((entry) => entry.text)).toEqual([
    "/goal Ship the result",
    "/goal Ship the result",
    "/goal Other objective",
    "/goal Ship the result",
    "/goal Ship the result",
  ]);
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(5);
});

it("new-thread acceptance, editing, mismatched receipts and invalid objectives do not append", () => {
  const store = new GoalTranscriptStore();
  for (const changes of [
    { source: "new-thread-first-turn" },
    { source: "goal-edit" },
    { goal: { ...goal, threadId: "other" } },
    { goal: { ...goal, objective: " " } },
    { goal: { ...goal, updatedAt: Number.NaN } },
    { goal: { ...goal, objective: "😀".repeat(4001) } },
  ])
    expect(append(store, changes)).toBe(false);
  expect(store.getSnapshot("owner")).toEqual([]);
});

it("retains exact accepted codepoints without holding a mutable receipt", () => {
  const store = new GoalTranscriptStore();
  const captured = { ...goal, objective: "😀".repeat(4000) };
  expect(append(store, { goal: captured, afterTurnId: null })).toBe(true);
  captured.objective = "changed later";
  expect(store.getSnapshot("owner")[0].text).toBe("/goal " + "😀".repeat(4000));
  expect(Object.isFrozen(store.getSnapshot("owner"))).toBe(true);
  expect(Object.isFrozen(store.getSnapshot("owner")[0])).toBe(true);
});

it("evicts old thread bodies and per-thread messages within explicit view budgets", () => {
  const store = new GoalTranscriptStore();
  for (let i = 0; i <= GOAL_TRANSCRIPT_LIMITS.threads; i++)
    append(store, {
      threadId: `thread-${i}`,
      goal: { ...goal, threadId: `thread-${i}` },
    });
  expect(store.size).toBe(GOAL_TRANSCRIPT_LIMITS.threads);
  expect(store.getSnapshot("thread-0")).toEqual([]);
  for (let i = 0; i < GOAL_TRANSCRIPT_LIMITS.perThread + 3; i++)
    append(store, { goal: { ...goal, objective: `objective-${i}` } });
  expect(store.getSnapshot("owner")).toHaveLength(
    GOAL_TRANSCRIPT_LIMITS.perThread,
  );
  expect(store.getSnapshot("owner")[0].text).toBe("/goal objective-3");
});

it("thread switching reads only the chosen snapshot; explicit runtime/account reset releases every prior body", () => {
  const store = new GoalTranscriptStore();
  append(store);
  append(store, {
    threadId: "other",
    goal: { ...goal, threadId: "other", objective: "Other owner's body" },
  });
  const owner = store.getSnapshot("owner");
  expect(store.getSnapshot("other")[0].text).toBe("/goal Other owner's body");
  expect(store.getSnapshot("owner")).toBe(owner);
  store.clear();
  expect(store.size).toBe(0);
  expect(store.getSnapshot("owner")).toEqual([]);
  expect(store.getSnapshot("other")).toEqual([]);
  append(store, { goal: { ...goal, objective: "New runtime body" } });
  expect(store.getSnapshot("owner").map((entry) => entry.text)).toEqual([
    "/goal New runtime body",
  ]);
});

it("the existing 60-second transcript release clears local Goal body and a dormant transcript cannot reacquire it", () => {
  vi.useFakeTimers();
  try {
    const threadId = "goal-release-owner";
    const release = retainCodexTranscript(threadId);
    const input = {
      threadId,
      goal: { ...goal, threadId },
      source: "existing-thread-goal-set" as const,
      afterTurnId: "native-before",
    };
    expect(appendGoalAnnouncement(input)).toBe(true);
    release();
    vi.advanceTimersByTime(60_001);
    expect(expiredCodexTranscripts()).toContain(threadId);
    markCodexTranscriptDormant(threadId);
    expect(getGoalAnnouncements(threadId)).toEqual([]);
    expect(appendGoalAnnouncement(input)).toBe(false);
    const visibleAgain = retainCodexTranscript(threadId);
    expect(appendGoalAnnouncement(input)).toBe(true);
    visibleAgain();
    markCodexTranscriptDormant(threadId);
  } finally {
    vi.useRealTimers();
    forgetCodexTranscript("goal-release-owner");
  }
});
