import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal, Turn } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { AgentMessageItem } from "@session/components/codex/items/AgentMessageItem";
import { GoalCompletionScope } from "./GoalCompletionBadge";

let language = "zh-CN";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value, i18n: { language } }),
}));
vi.mock("@session/components/codex/presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <p>{value}</p>,
}));
vi.mock("@session/features/git/NativeReviewFindings", () => ({
  NativeReviewFindings: () => null,
}));
vi.mock(
  "@session/components/codex/composer/v2/MessageReferenceActions",
  () => ({ MessageReferenceActions: () => null }),
);
vi.mock("@session/features/thread-workflows/NativeMessageFork", () => ({
  NativeMessageFork: () => null,
}));
vi.mock("@session/components/codex/items/NativeHookStats", () => ({
  NativeHookStats: () => null,
}));
vi.mock("@session/components/codex/items/NativeMemoryCitations", () => ({
  NativeMemoryCitations: () => null,
}));
const goal: ThreadGoal = {
  threadId: "owner",
  objective: "Ship the result",
  status: "complete",
  tokenBudget: 100,
  tokensUsed: 12,
  timeUsedSeconds: 3661,
  createdAt: 1,
  updatedAt: 100,
};
const turn = (id: string, startedAt: number): Turn => ({
  id,
  startedAt,
  status: "completed",
  items: [],
  itemsView: "full",
  completedAt: null,
  durationMs: null,
  error: null,
});
beforeEach(() => {
  language = "zh-CN";
  useCodexStore.setState({
    goalMap: {},
    completedGoalMap: {},
    events: {},
    threads: [{ id: "owner", cwd: "/owner", turns: [] } as never],
  });
  const store = useCodexStore.getState();
  store.addEvent("owner", {
    method: "turn/completed",
    params: { threadId: "owner", turn: turn("achieved", 99) },
  });
  for (const id of ["first", "last"])
    store.addEvent("owner", {
      method: "item/completed",
      params: {
        threadId: "owner",
        turnId: "achieved",
        completedAtMs: 100_000,
        item: {
          type: "agentMessage",
          id,
          text: id,
          phase: "final_answer",
          memoryCitation: null,
        },
      },
    });
  store.setGoal("owner", goal);
});
const message = (itemId: string, turnId = "achieved", streaming = false) => (
  <AgentMessageItem
    key={itemId}
    threadId="owner"
    turnId={turnId}
    itemId={itemId}
    text={itemId}
    streaming={streaming}
  />
);

it("shows the native recorded duration on only the selected turn's final assistant action row, surviving clear", () => {
  const view = render(
    <GoalCompletionScope threadId="owner">
      {message("first")}
      {message("last")}
      {message("later", "later")}
    </GoalCompletionScope>,
  );
  expect(screen.getAllByText("已在 1h 1m 1s 内达成目标")).toHaveLength(1);
  const badge = view.container.querySelector("[data-goal-achieved]")!;
  expect(badge.closest(".codex-message-native-actions")).toBeTruthy();
  expect(
    badge.closest("[data-owner-turn]")?.getAttribute("data-owner-turn"),
  ).toBe("achieved");
  expect(
    badge.querySelector("svg")?.getAttribute("data-goal-completion-icon"),
  ).toBe("checkmark-circle-light-16");
  act(() => useCodexStore.getState().clearGoal("owner"));
  expect(screen.getByText("已在 1h 1m 1s 内达成目标")).toBeTruthy();
  act(() =>
    useCodexStore
      .getState()
      .setGoal("owner", { ...goal, status: "active", updatedAt: 102 }),
  );
  expect(view.container.querySelector("[data-goal-achieved]")).toBeNull();
});

it("uses the English native label and never advances a completed duration from the wall clock", () => {
  language = "en";
  const now = vi.spyOn(Date, "now").mockReturnValue(999_999_000);
  try {
    render(
      <GoalCompletionScope threadId="owner">
        {message("last")}
      </GoalCompletionScope>,
    );
    expect(screen.getByText("Goal achieved in 1h 1m 1s")).toBeTruthy();
  } finally {
    now.mockRestore();
  }
});

it("does not expose completion on streaming, foreign, or unscoped messages", () => {
  const view = render(
    <>
      <GoalCompletionScope threadId="owner">
        {message("last", "achieved", true)}
        <AgentMessageItem
          threadId="foreign"
          turnId="achieved"
          itemId="last"
          text="foreign"
        />
      </GoalCompletionScope>
      {message("last")}
    </>,
  );
  expect(view.container.querySelector("[data-goal-achieved]")).toBeNull();
});
