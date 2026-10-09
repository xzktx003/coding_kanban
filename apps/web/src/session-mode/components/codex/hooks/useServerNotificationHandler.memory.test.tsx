import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSubagentStore } from "@session/features/subagents/store";
import { useServerNotificationHandler } from "./useServerNotificationHandler";
import { allowSleep } from "@session/services/apiAdapt";

vi.mock("@session/services/apiAdapt", () => ({
  allowSleep: vi.fn().mockResolvedValue(undefined),
  preventSleep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/lib/notify", () => ({ notifyDesktop: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCenterStore.setState({ cards: [], detachedCard: null });
  useSubagentStore.setState({ nodes: {}, families: {}, selection: {} });
  useCodexStore.setState({
    events: {},
    threads: [],
    currentThreadId: null,
    currentTurnId: null,
    historyLoadedMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
    commandStatusMap: {},
    commandDurationMap: {},
    tokenUsageMap: {},
    goalMap: {},
  });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
    drafts: {},
  });
});
function handler() {
  return renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: false },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  ).result;
}
const reply = (threadId: string) =>
  ({
    method: "item/completed",
    params: {
      threadId,
      turnId: "turn",
      item: {
        type: "agentMessage",
        id: "reply",
        text: "完整回复",
        phase: null,
        memoryCitation: null,
      },
    },
  }) as any;

it("does not retain messages or discover children from an unrelated global thread", () => {
  const h = handler();
  act(() => {
    h.current(reply("unopened"));
    h.current({
      method: "item/completed",
      params: {
        threadId: "unopened",
        turnId: "turn",
        item: {
          type: "collabAgentToolCall",
          id: "spawn",
          tool: "spawnAgent",
          receiverThreadIds: ["unrelated-child"],
          agentsStates: {},
          prompt: "x".repeat(100_000),
        },
      },
    } as any);
  });
  expect(useCodexStore.getState().events).toEqual({});
  expect(useSubagentStore.getState().nodes).toEqual({});
});

it.each(["followed", "detached", "current"])(
  "preserves transcript for %s sessions",
  (membership) => {
    if (membership === "followed")
      useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
    if (membership === "detached")
      useAgentCenterStore.setState({
        detachedCard: { kind: "codex", id: "a" },
      });
    if (membership === "current")
      useCodexStore.setState({ currentThreadId: "a" });
    const h = handler();
    act(() => h.current(reply("a")));
    expect(useCodexStore.getState().events.a).toContainEqual(reply("a"));
  },
);

it("discovers and observes children of a followed parent without adding them to tabs", () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "parent" }] });
  const h = handler();
  act(() => {
    h.current({
      method: "item/completed",
      params: {
        threadId: "parent",
        turnId: "turn",
        item: {
          type: "collabAgentToolCall",
          id: "spawn",
          tool: "spawnAgent",
          receiverThreadIds: ["child"],
          agentsStates: {},
        },
      },
    } as any);
    h.current(reply("child"));
  });
  expect(useSubagentStore.getState().nodes.child.parentId).toBe("parent");
  expect(useCodexStore.getState().events.child).toContainEqual(reply("child"));
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "parent",
  ]);
  const before = useCodexStore.getState().events.child;
  act(() => useAgentCenterStore.setState({ cards: [] }));
  act(() =>
    h.current({
      ...reply("child"),
      params: {
        ...reply("child").params,
        item: { ...reply("child").params.item, id: "another-reply" },
      },
    }),
  );
  expect(useCodexStore.getState().events.child).toBe(before);
});

it("expires pending questions for an unobserved completed turn without retaining its large body", () => {
  useRequestUserInputStore.getState().addRequest({
    threadId: "unopened",
    requestId: 1,
    turnId: "turn",
    itemId: "i",
    questions: [],
  });
  const h = handler();
  act(() =>
    h.current({
      method: "turn/completed",
      params: {
        threadId: "unopened",
        turn: {
          id: "turn",
          status: "completed",
          items: [
            { type: "agentMessage", id: "reply", text: "x".repeat(100_000) },
          ],
        },
      },
    } as any),
  );
  expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(0);
  expect(useCodexStore.getState().events).toEqual({});
  expect(allowSleep).toHaveBeenCalledWith("unopened");
});
