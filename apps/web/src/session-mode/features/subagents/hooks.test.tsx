import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSubagentFamily, useSubagentFamilySync } from "./hooks";
import { observeSubagents, useSubagentStore } from "./store";
import { subagentStorageKey } from "./scope";
import { subagentScope } from "./scope";
import { usePairingStore } from "@session/stores/usePairingStore";

vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn(() => () => {}),
}));

vi.mock("@session/lib/notify", () => ({
  notifyDesktop: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  usePairingStore.setState({ desktops: [], selectedHost: null });
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
    scope: subagentScope(),
  });
});

it.each(["port", "token"] as const)(
  "re-pairing the selected host with a new %s withdraws old metadata authority",
  (field) => {
    const desktop = {
      host: "fixture.invalid",
      port: 7420,
      token: "fixture-before",
      name: "Fixture",
    };
    usePairingStore.setState({
      desktops: [desktop],
      selectedHost: desktop.host,
    });
    useSubagentStore.setState({ scope: subagentScope() });
    const otherScope = `http://${desktop.host}:7421`;
    const foreignChild = {
      parentId: "new-parent",
      revision: 0,
      verified: true,
      thread: {
        id: "same-id",
        parentThreadId: "new-parent",
        canAcceptDirectInput: true,
      },
    };
    localStorage.setItem(
      `kanban.session.subagent-families:${otherScope}`,
      JSON.stringify({
        version: 1,
        state: {
          nodes: { "same-id": foreignChild },
          selection: {},
          panelRoot: null,
        },
      }),
    );
    const { rerender } = renderHook(() => useSubagentFamilySync());
    act(() => {
      useSubagentStore
        .getState()
        .apply(
          "root",
          {
            threads: [
              {
                id: "child",
                parentThreadId: "root",
                canAcceptDirectInput: true,
              },
            ],
            complete: true,
            errors: [],
            checkedAt: 1,
          },
          useSubagentStore.getState().revision,
        );
      useCodexStore.setState({
        threads: [
          { id: "same-id", source: "cli", parentThreadId: null },
        ] as any,
      });
    });
    const epoch = useSubagentStore.getState().runtimeEpoch;
    const restarted = vi.spyOn(window, "dispatchEvent");
    act(() =>
      usePairingStore
        .getState()
        .addDesktop({
          ...desktop,
          [field]: field === "port" ? 7421 : "fixture-after",
        }),
    );
    expect(
      restarted.mock.calls.filter(
        ([event]) => event.type === "session-runtime-restarted",
      ),
    ).toHaveLength(1);
    restarted.mockRestore();
    expect(useSubagentStore.getState().runtimeEpoch).toBe(epoch + 1);
    expect(useCodexStore.getState().threads).toEqual([]);
    if (field === "port") {
      // A subsequent render cannot use the previous host's root list to delete a new child.
      rerender();
      expect(useSubagentStore.getState().scope).toBe(otherScope);
      expect(useSubagentStore.getState().nodes["same-id"].parentId).toBe(
        "new-parent",
      );
      expect(
        useSubagentStore.getState().nodes["same-id"].thread
          .canAcceptDirectInput,
      ).toBeNull();
    } else {
      expect(
        useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
      ).toBeNull();
    }
  },
);

it("fresh main metadata repairs persisted identity without rescanning unchanged history", () => {
  const child = {
    thread: {
      id: "child",
      parentThreadId: "root",
      canAcceptDirectInput: false,
    },
    parentId: "root",
    verified: true,
    revision: 1,
  };
  useSubagentStore.setState({
    nodes: {
      root: {
        thread: { id: "root", canAcceptDirectInput: null },
        parentId: "child",
        verified: false,
        unavailable: true,
        revision: 1,
      },
      child,
    },
  });
  const iterate = vi.fn(function* () {});
  const history = Object.assign([], { [Symbol.iterator]: iterate });
  useCodexStore.setState({ events: { root: history } });
  let renders = 0;
  renderHook(() => {
    renders++;
    useSubagentFamilySync();
  });
  expect(iterate).toHaveBeenCalledOnce();

  act(() =>
    useCodexStore.setState({
      threads: [{ id: "root", source: "cli", parentThreadId: null }] as any,
    }),
  );
  expect(useSubagentStore.getState().nodes.root).toBeUndefined();
  expect(useSubagentStore.getState().nodes.child).toBe(child);
  expect(
    JSON.parse(localStorage.getItem(subagentStorageKey())!).state.nodes.root,
  ).toBeUndefined();

  const changed = vi.fn();
  const unsubscribe = useSubagentStore.subscribe(changed);
  const stableRenders = renders;
  act(() =>
    useCodexStore.setState({
      threads: [
        { id: "root", source: "cli", parentThreadId: null, updatedAt: 2 },
      ] as any,
    }),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(renders).toBe(stableRenders);
  expect(iterate).toHaveBeenCalledOnce();
  unsubscribe();
});

it("unknown parent metadata cannot clear a child's conservative permission boundary", () => {
  const child = {
    thread: { id: "child", canAcceptDirectInput: null },
    parentId: "root",
    verified: false,
    revision: 1,
  };
  useSubagentStore.setState({ nodes: { child } });
  useCodexStore.setState({
    threads: [{ id: "child", source: "unknown", parentThreadId: null }] as any,
  });
  renderHook(() => useSubagentFamilySync());
  expect(useSubagentStore.getState().nodes.child).toBe(child);
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

  const spawnEvent = {
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
  } as any;
  act(() => {
    observeSubagents(spawnEvent);
    useCodexStore.getState().addEvent("root", spawnEvent);
  });
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
