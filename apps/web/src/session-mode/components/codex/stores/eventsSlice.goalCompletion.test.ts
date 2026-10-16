import { beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";
import { useCodexStore } from "./useCodexStore";
import { threadGoalVersions } from "@session/services/threadGoalState";

const complete: ThreadGoal = {
  threadId: "owner",
  objective: "Ship",
  status: "complete",
  tokenBudget: null,
  tokensUsed: 12,
  timeUsedSeconds: 61,
  createdAt: 1,
  updatedAt: 100,
};
const update = (goal: ThreadGoal) =>
  useCodexStore.getState().addEvent("owner", {
    method: "thread/goal/updated",
    params: { threadId: "owner", turnId: null, goal },
  });

beforeEach(() => {
  threadGoalVersions.reset();
  useCodexStore.setState({ goalMap: {}, completedGoalMap: {}, events: {} });
});

it("retains completed goal metadata after the native clear notification", () => {
  update(complete);
  expect(useCodexStore.getState().completedGoalMap.owner).toEqual(complete);
  useCodexStore.getState().addEvent("owner", {
    method: "thread/goal/cleared",
    params: { threadId: "owner" },
  });
  expect(useCodexStore.getState().goalMap.owner).toBeUndefined();
  expect(useCodexStore.getState().completedGoalMap.owner).toEqual(complete);
  expect(useCodexStore.getState().events.owner).toBeUndefined();
});

it("keeps completion when a clear ACK or absent goal read follows completion", () => {
  useCodexStore.getState().setGoal("owner", complete);
  useCodexStore.getState().clearGoal("owner");
  useCodexStore.getState().clearGoal("owner");
  expect(useCodexStore.getState().completedGoalMap.owner).toEqual(complete);
});

it.each([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
] as const)(
  "clears a previous completion when a new %s goal arrives",
  (status) => {
    update(complete);
    update({ ...complete, objective: "Next result", status, updatedAt: 102 });
    expect(useCodexStore.getState().completedGoalMap.owner).toBeUndefined();
  },
);

it("does not notify subscribers for an identical completion while still fencing older reads", () => {
  update(complete);
  const revision = threadGoalVersions.capture("owner");
  const listener = vi.fn();
  const unsubscribe = useCodexStore.subscribe(listener);
  update({ ...complete });
  expect(listener).not.toHaveBeenCalled();
  expect(threadGoalVersions.matches("owner", revision)).toBe(false);
  unsubscribe();
});

it("does not accept a foreign or invalid completion into either goal map", () => {
  update({ ...complete, threadId: "foreign" });
  update({ ...complete, updatedAt: Number.NaN });
  expect(useCodexStore.getState().goalMap).toEqual({});
  expect(useCodexStore.getState().completedGoalMap).toEqual({});
});
