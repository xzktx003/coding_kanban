import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoalTranscriptAnnouncements } from "./GoalTranscriptAnnouncements";
import {
  appendGoalAnnouncement,
  clearGoalAnnouncements,
  useGoalAnnouncements,
} from "./goalTranscript";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useCodexAccessStore } from "@session/stores/useCodexAccessStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => true,
}));
vi.mock("@session/components/codex/presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@session/components/common", () => ({
  CopyButton: () => null,
  AddToTodo: () => null,
}));
const goal = {
  threadId: "owner",
  objective: "Ship the result",
  updatedAt: 100,
};
const Harness = ({ threadId }: { threadId: string }) => (
  <GoalTranscriptAnnouncements
    announcements={useGoalAnnouncements(threadId)}
    placement="after"
  />
);
beforeEach(() => {
  clearGoalAnnouncements();
  useCodexStore.setState({
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
  });
  useCodexAccessStore.setState({
    entries: {
      owner: {
        access: { state: "readonly", reason: "fixture history", generation: 2 },
      },
    },
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it("renders a completed standard user bubble with copy but no edit, rollback, native turn or item navigation identity", () => {
  const events = useCodexStore.getState().events;
  const timing = useCodexStore.getState().turnTimingMap;
  const authority = useCodexAccessStore.getState().entries;
  appendGoalAnnouncement({
    threadId: "owner",
    goal,
    source: "existing-thread-goal-set",
    afterTurnId: "native",
  });
  const view = render(<Harness threadId="owner" />);
  expect(
    screen.getByText("/goal Ship the result").closest(".codex-user-bubble"),
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll("[data-goal-announcement]"),
  ).toHaveLength(1);
  expect(view.container.querySelector("[data-owner-turn]")).toBeNull();
  expect(
    view.container.querySelector(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "userMessage.edit" })).toBeNull();
  expect(view.container.querySelectorAll("button")).toHaveLength(1);
  expect(useCodexStore.getState().events).toBe(events);
  expect(useCodexStore.getState().turnTimingMap).toBe(timing);
  expect(useCodexAccessStore.getState().entries).toBe(authority);
  expect(fetch).not.toHaveBeenCalled();
});

it("visible thread switches cannot show another owner's body and reset immediately removes the previous runtime body", () => {
  appendGoalAnnouncement({
    threadId: "owner",
    goal,
    source: "existing-thread-goal-set",
    afterTurnId: null,
  });
  appendGoalAnnouncement({
    threadId: "other",
    goal: { ...goal, threadId: "other", objective: "Other owner's body" },
    source: "existing-thread-goal-set",
    afterTurnId: null,
  });
  const view = render(<Harness threadId="owner" />);
  expect(screen.getByText("/goal Ship the result")).toBeTruthy();
  view.rerender(<Harness threadId="other" />);
  expect(screen.queryByText("/goal Ship the result")).toBeNull();
  expect(screen.getByText("/goal Other owner's body")).toBeTruthy();
  act(() => clearGoalAnnouncements());
  expect(screen.queryByText("/goal Other owner's body")).toBeNull();
  expect(
    view.container.querySelectorAll("[data-goal-announcement]"),
  ).toHaveLength(0);
});
