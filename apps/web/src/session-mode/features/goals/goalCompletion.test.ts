import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import type { ThreadGoal, Turn } from "@session/bindings/v2";
import { completedGoalTurnId, projectGoalCompletion } from "./goalCompletion";

const goal: ThreadGoal = {
  threadId: "owner",
  objective: "Ship the result",
  status: "complete",
  tokenBudget: null,
  tokensUsed: 12,
  timeUsedSeconds: 3661,
  createdAt: 1,
  updatedAt: 100,
};
const turn = (
  id: string,
  startedAt: number | null,
  status: Turn["status"] = "completed",
): Turn => ({
  id,
  startedAt,
  status,
  items: [],
  itemsView: "full",
  completedAt: null,
  durationMs: null,
  error: null,
});
const completed = (value: Turn): ServerNotification => ({
  method: "turn/completed",
  params: { threadId: "owner", turn: value },
});
const reply = (
  turnId: string,
  id: string,
  phase: "commentary" | "final_answer" = "final_answer",
): ServerNotification => ({
  method: "item/completed",
  params: {
    threadId: "owner",
    turnId,
    completedAtMs: 100_000,
    item: { type: "agentMessage", id, text: id, phase, memoryCitation: null },
  },
});

describe("native Fp completed goal turn selection", () => {
  it("skips turns starting after the goal update and selects the last eligible completed turn", () => {
    expect(
      completedGoalTurnId(
        [turn("older", 1), turn("achieved", 99), turn("later", 101)],
        goal,
      ),
    ).toBe("achieved");
    expect(completedGoalTurnId([turn("boundary", 100)], goal)).toBe("boundary");
  });

  it.each(["inProgress", "failed", "interrupted"] as const)(
    "does not skip an eligible %s turn to claim an older completion",
    (status) => {
      expect(
        completedGoalTurnId(
          [turn("older", 1), turn("latest", 99, status)],
          goal,
        ),
      ).toBeNull();
    },
  );

  it("treats a missing start timestamp as eligible, matching the official predicate", () => {
    expect(
      completedGoalTurnId([turn("older", 1), turn("unknown-time", null)], goal),
    ).toBe("unknown-time");
    expect(completedGoalTurnId([], goal)).toBeNull();
  });

  it("requires a complete goal", () => {
    expect(
      completedGoalTurnId([turn("done", 1)], { ...goal, status: "active" }),
    ).toBeNull();
  });
});

it("projects one final assistant item in the selected turn and never another thread", () => {
  const events = [
    completed(turn("achieved", 99)),
    reply("achieved", "commentary", "commentary"),
    reply("achieved", "final-first"),
    reply("achieved", "final-last"),
    {
      ...reply("achieved", "foreign"),
      params: {
        ...(reply("achieved", "foreign") as any).params,
        threadId: "other",
      },
    } as ServerNotification,
    completed(turn("later", 101)),
    reply("later", "too-late"),
  ];
  expect(projectGoalCompletion("owner", goal, events, [])).toEqual({
    turnId: "achieved",
    itemId: "final-last",
  });
});

it("merges bounded live lifecycle with loaded turn metadata without retaining message bodies", () => {
  expect(
    projectGoalCompletion(
      "owner",
      goal,
      [reply("achieved", "answer")],
      [turn("achieved", 99), turn("later", 101, "inProgress")],
    ),
  ).toEqual({ turnId: "achieved", itemId: "answer" });
  expect(
    projectGoalCompletion("owner", goal, [completed(turn("achieved", 99))], []),
  ).toEqual({ turnId: "achieved", itemId: null });
});

it("selects a tool-only completed turn for its own fallback instead of an older assistant", () => {
  expect(
    projectGoalCompletion(
      "owner",
      goal,
      [
        completed(turn("older", 1)),
        reply("older", "old-answer"),
        completed(turn("tool-only", 99)),
      ],
      [],
    ),
  ).toEqual({ turnId: "tool-only", itemId: null });
});

it("moves a late completion from in-progress to completed without changing turn order", () => {
  expect(
    projectGoalCompletion(
      "owner",
      goal,
      [
        {
          method: "turn/started",
          params: {
            threadId: "owner",
            turn: turn("achieved", 99, "inProgress"),
          },
        },
        reply("achieved", "answer"),
        completed(turn("achieved", 99)),
      ],
      [],
    ),
  ).toEqual({ turnId: "achieved", itemId: "answer" });
});
