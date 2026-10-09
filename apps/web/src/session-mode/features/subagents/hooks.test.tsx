import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSubagentFamily, useSubagentFamilySync } from "./hooks";
import { useSubagentStore } from "./store";

vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn(() => () => {}),
}));

vi.mock("@session/lib/notify", () => ({
  notifyDesktop: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "root" }],
    sharedTabsInitialized: true,
  });
  useCodexStore.setState({
    events: {},
    threads: [],
    threadStatusMap: {},
    turnTimingMap: {},
    currentThreadId: null,
    currentTurnId: null,
  });
  useSubagentStore.setState({
    nodes: {},
    families: {},
    revision: 0,
    runtimeEpoch: 0,
  });
});

it("keeps the visible family hook isolated from sibling and unrelated Codex updates", () => {
  useSubagentStore.getState().apply(
    "root",
    {
      threads: [
        {
          id: "child",
          parentThreadId: "root",
          status: { type: "active", activeFlags: [] },
        },
      ],
      complete: true,
      errors: [],
      checkedAt: 1,
    },
    0,
  );
  useSubagentStore.getState().apply(
    "sibling-root",
    {
      threads: [
        {
          id: "sibling-child",
          parentThreadId: "sibling-root",
          status: { type: "idle" },
        },
      ],
      complete: true,
      errors: [],
      checkedAt: 1,
    },
    0,
  );
  useCodexStore.setState({
    threads: [
      { id: "root", turns: [{ id: "root-turn", status: "completed" }] },
      { id: "child", turns: [] },
      { id: "sibling-root", turns: [] },
      { id: "sibling-child", turns: [] },
      { id: "outside", turns: [] },
    ] as any,
    threadStatusMap: {
      child: { type: "active", activeFlags: [] },
      "sibling-child": { type: "idle" },
    },
    turnTimingMap: {
      child: {
        turnId: "child-turn",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });

  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    return useSubagentFamily("root");
  });
  expect(renders).toBe(1);
  expect(result.current.rows[0]?.state).toBe("running");

  act(() =>
    useCodexStore.getState().addEvent("outside", {
      method: "turn/started",
      params: {
        threadId: "outside",
        turn: { id: "outside-turn", status: "inProgress" },
      },
    } as any),
  );
  act(() =>
    useCodexStore.getState().addEvent("sibling-child", {
      method: "thread/status/changed",
      params: {
        threadId: "sibling-child",
        status: { type: "active", activeFlags: [] },
      },
    } as any),
  );

  expect(renders).toBe(1);

  act(() =>
    useCodexStore.getState().addEvent("child", {
      method: "turn/completed",
      params: {
        threadId: "child",
        turn: {
          id: "child-turn",
          status: "completed",
          durationMs: 1,
          items: [],
        },
      },
    } as any),
  );

  expect(renders).toBe(2);
  expect(result.current.rows[0]?.state).toBe("completed");
});

it("keeps family history sync isolated from unrelated thread events", async () => {
  let renders = 0;
  renderHook(() => {
    renders += 1;
    useSubagentFamilySync();
  });
  expect(renders).toBe(1);

  act(() =>
    useCodexStore.getState().addEvent("outside", {
      method: "item/completed",
      params: {
        threadId: "outside",
        turnId: "outside-turn",
        item: {
          type: "agentMessage",
          id: "outside-item",
          text: "x".repeat(10_000),
        },
      },
    } as any),
  );
  expect(renders).toBe(1);

  act(() =>
    useCodexStore.getState().addEvent("root", {
      method: "item/started",
      params: {
        threadId: "root",
        turnId: "turn",
        item: {
          id: "spawn",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          senderThreadId: "root",
          receiverThreadIds: ["child"],
          agentsStates: { child: { status: "running" } },
          status: "inProgress",
        },
      },
    } as any),
  );
  await waitFor(() =>
    expect(useSubagentStore.getState().nodes.child?.parentId).toBe("root"),
  );
  const rendersAfterRootHistory = renders;

  act(() =>
    useCodexStore.getState().addEvent("outside-2", {
      method: "item/completed",
      params: {
        threadId: "outside-2",
        turnId: "outside-turn",
        item: {
          type: "agentMessage",
          id: "outside-item-2",
          text: "y".repeat(10_000),
        },
      },
    } as any),
  );
  expect(renders).toBe(rendersAfterRootHistory);

  act(() =>
    useCodexStore.getState().addEvent("child", {
      method: "thread/status/changed",
      params: {
        threadId: "child",
        status: { type: "idle" },
      },
    } as any),
  );
  await waitFor(() =>
    expect(useSubagentStore.getState().nodes.child.thread.status?.type).toBe(
      "idle",
    ),
  );
});
