import { beforeEach, expect, it, vi } from "vitest";

const cancelCodexHistoryRead = vi.hoisted(() => vi.fn());

vi.mock("./codexService", () => ({ cancelCodexHistoryRead }));

import type { Thread } from "../bindings/v2";
import { useCodexStore } from "../components/codex/stores";
import { useSubagentStore } from "../features/subagents/store";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import {
  cachedTranscriptBaselines,
  cachedTranscriptTimings,
} from "./sessionCacheState";
import {
  pruneUnobservedCodexTranscripts,
  startSessionTranscriptRetention,
} from "./sessionTranscriptRetention";

const flushRetention = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const thread = (id: string): Thread =>
  ({
    id,
    preview: id,
    cwd: "/repo",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" },
    turns: [
      {
        id: `${id}-turn`,
        status: "completed",
        startedAt: 1,
        durationMs: 1,
        items: [{ id: `${id}-item`, type: "agentMessage", text: "heavy" }],
      },
    ],
  }) as Thread;

const transcriptEvents = (threadId: string, turns: number, body: string) =>
  Array.from({ length: turns }, (_, index) => [
    {
      method: "item/completed",
      params: {
        threadId,
        turnId: `turn-${index}`,
        item: {
          id: `agent-${index}`,
          type: "agentMessage",
          text: `${body}-${index}`,
          phase: null,
          memoryCitation: null,
        },
        completedAtMs: index,
      },
    },
    {
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: `turn-${index}`,
          status: "completed",
          startedAt: index,
          durationMs: 1,
          items: [],
        },
      },
    },
  ]).flat() as any[];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  cachedTranscriptBaselines.clear();
  cachedTranscriptTimings.clear();
  useAgentCenterStore.setState({
    cards: [],
    detachedCard: null,
    pendingTabOperations: [],
    sharedTabsInitialized: false,
    currentAgentCardId: null,
    currentAgentCardKind: null,
  });
  useSubagentStore.setState({ nodes: {}, families: {}, revision: 0 });
  useSessionSyncStore.setState({
    recovering: {},
    checking: {},
    cursors: {},
    trimmedHistoryAnchors: {},
    earlierLoading: {},
    earlierErrors: {},
    connection: "connected",
  });
  useCodexStore.setState({
    threads: [],
    currentThreadId: null,
    currentTurnId: null,
    activeThreadIds: [],
    events: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    retryNoticeMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
  });
});

it("trims old completed turns from an observed transcript over budget while keeping it loaded", () => {
  const events = transcriptEvents("heavy", 12, "x".repeat(600_000));
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "heavy", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("heavy")],
    events: { heavy: events },
    historyLoadedMap: { heavy: true },
    turnTimingMap: {
      heavy: {
        turnId: "turn-11",
        startedAtMs: 11000,
        durationMs: 1,
        status: "completed",
      },
    },
  });

  pruneUnobservedCodexTranscripts();

  const state = useCodexStore.getState();
  const remaining = state.events.heavy ?? [];
  expect(remaining.length).toBeLessThan(events.length);
  expect(
    remaining.some((event: any) => event.params?.turnId === "turn-0"),
  ).toBe(false);
  expect(
    remaining.some((event: any) => event.params?.turnId === "turn-11"),
  ).toBe(true);
  expect(state.historyLoadedMap.heavy).toBe(true);
  expect(useSessionSyncStore.getState().trimmedHistoryAnchors.heavy).toBe(
    "turn-0",
  );
  expect(cancelCodexHistoryRead).toHaveBeenCalledWith("heavy");
});

it("does not trim an observed transcript while the user is reading old rows", () => {
  const events = transcriptEvents("reading", 12, "x".repeat(600_000));
  localStorage.setItem(
    "kanban.session.read-position.codex:reading",
    JSON.stringify({
      atBottom: false,
      anchor: "event-turn-0-agent-0",
      offset: 0,
      scrollTop: 0,
      format: "row",
    }),
  );
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "reading", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("reading")],
    events: { reading: events },
    historyLoadedMap: { reading: true },
  });

  pruneUnobservedCodexTranscripts();

  expect(useCodexStore.getState().events.reading).toBe(events);
  expect(
    useSessionSyncStore.getState().trimmedHistoryAnchors.reading,
  ).toBeUndefined();
  expect(cancelCodexHistoryRead).not.toHaveBeenCalled();
});

it("releases transcript bodies and sync pagination when a codex thread leaves observation", async () => {
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "open", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("open"), thread("closed")],
    events: {
      open: [{ method: "thread/started", params: {} } as any],
      closed: [{ method: "thread/started", params: {} } as any],
    },
    historyLoadedMap: { open: true, closed: true },
    historyLoadingMap: { closed: true },
    historyErrorMap: { closed: "old error" },
    retryNoticeMap: { closed: "retry" },
    threadStatusMap: { closed: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      closed: {
        turnId: "closed-turn",
        startedAtMs: 1000,
        durationMs: null,
        status: "inProgress",
      },
    },
  });
  useSessionSyncStore.setState({
    checking: { closed: true },
    recovering: { closed: "syncing" },
    cursors: { closed: "cursor" },
    earlierLoading: { closed: true },
    earlierErrors: { closed: "bad" },
  });
  cachedTranscriptBaselines.set("closed", [
    { method: "item/completed", params: {} } as any,
  ]);
  cachedTranscriptTimings.set("closed", {
    turnId: "closed-turn",
    startedAtMs: 1000,
    durationMs: null,
    status: "inProgress",
  });

  pruneUnobservedCodexTranscripts();

  const state = useCodexStore.getState();
  expect(state.events.open).toHaveLength(1);
  expect(state.events.closed).toBeUndefined();
  expect(state.historyLoadedMap.closed).toBeUndefined();
  expect(state.historyLoadingMap.closed).toBeUndefined();
  expect(state.historyErrorMap.closed).toBeUndefined();
  expect(state.retryNoticeMap.closed).toBeUndefined();
  expect(state.threads.find((item) => item.id === "closed")?.turns).toEqual([]);
  expect(state.threadStatusMap.closed).toEqual({
    type: "active",
    activeFlags: [],
  });
  expect(state.turnTimingMap.closed?.turnId).toBe("closed-turn");
  expect(useSessionSyncStore.getState().cursors.closed).toBeUndefined();
  expect(useSessionSyncStore.getState().checking.closed).toBeUndefined();
  expect(cachedTranscriptBaselines.has("closed")).toBe(false);
  expect(cachedTranscriptTimings.has("closed")).toBe(false);
  expect(cancelCodexHistoryRead).toHaveBeenCalledWith("closed");
});

it("keeps current, detached, and descendant subagent transcripts observed", () => {
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "root", cwd: "/repo" }],
    detachedCard: { kind: "codex", id: "detached", cwd: "/repo" },
  });
  useCodexStore.setState({
    currentThreadId: "current",
    threads: [
      thread("root"),
      thread("child"),
      thread("detached"),
      thread("current"),
    ],
    events: {
      root: [{ method: "thread/started", params: {} } as any],
      child: [{ method: "thread/started", params: {} } as any],
      detached: [{ method: "thread/started", params: {} } as any],
      current: [{ method: "thread/started", params: {} } as any],
    },
    historyLoadedMap: {
      root: true,
      child: true,
      detached: true,
      current: true,
    },
  });
  useSubagentStore.setState({
    nodes: {
      child: {
        parentId: "root",
        verified: true,
        revision: 1,
        thread: { id: "child", status: { type: "idle" } } as any,
      },
    },
  });

  pruneUnobservedCodexTranscripts();

  expect(Object.keys(useCodexStore.getState().events).sort()).toEqual([
    "child",
    "current",
    "detached",
    "root",
  ]);
  expect(cancelCodexHistoryRead).not.toHaveBeenCalled();
});

it("coalesces close and reopen in the same tick before pruning", async () => {
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "again", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("again")],
    events: { again: [{ method: "thread/started", params: {} } as any] },
    historyLoadedMap: { again: true },
  });
  const stop = startSessionTranscriptRetention();
  useAgentCenterStore.setState({ cards: [] });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "again", cwd: "/repo" }],
  });
  await flushRetention();
  stop();

  expect(useCodexStore.getState().events.again).toHaveLength(1);
  expect(cancelCodexHistoryRead).not.toHaveBeenCalled();
});

it("stops observing store changes after unsubscribe", async () => {
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "gone", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("gone")],
    events: { gone: [{ method: "thread/started", params: {} } as any] },
    historyLoadedMap: { gone: true },
  });
  const stop = startSessionTranscriptRetention();
  await flushRetention();
  stop();
  useAgentCenterStore.setState({ cards: [] });
  await flushRetention();

  expect(useCodexStore.getState().events.gone).toHaveLength(1);
});

it("does not rewrite stores or loop when only unobserved empty metadata remains", async () => {
  useAgentCenterStore.setState({ sharedTabsInitialized: true, cards: [] });
  useCodexStore.setState({
    threads: [{ ...thread("metadata-only"), turns: [] }],
    events: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
  });
  let updates = 0;
  const unsubscribe = useCodexStore.subscribe(() => {
    updates += 1;
  });

  const stop = startSessionTranscriptRetention();
  await flushRetention();
  await flushRetention();
  stop();
  unsubscribe();

  expect(updates).toBe(0);
  expect(useCodexStore.getState().threads[0]?.id).toBe("metadata-only");
  expect(cancelCodexHistoryRead).not.toHaveBeenCalled();
});

it("filters legacy hidden payloads from observed HMR caches without rewriting visible transcript semantics", async () => {
  useAgentCenterStore.setState({
    sharedTabsInitialized: true,
    cards: [{ kind: "codex", id: "legacy", cwd: "/repo" }],
  });
  useCodexStore.setState({
    threads: [thread("legacy")],
    events: {
      legacy: [
        {
          method: "item/agentMessage/delta",
          params: {
            threadId: "legacy",
            turnId: "turn",
            itemId: "agent",
            delta: "visible body",
          },
        } as any,
        {
          method: "item/commandExecution/outputDelta",
          params: {
            threadId: "legacy",
            turnId: "turn",
            itemId: "cmd",
            delta: "hidden streamed output",
          },
        } as any,
        {
          method: "item/fileChange/outputDelta",
          params: {
            threadId: "legacy",
            turnId: "turn",
            itemId: "patch",
            delta: "hidden patch output",
          },
        } as any,
        {
          method: "rawResponseItem/completed",
          params: {
            threadId: "legacy",
            turnId: "turn",
            item: { type: "message", content: "hidden raw" },
          },
        } as any,
        {
          method: "item/completed",
          params: {
            threadId: "legacy",
            turnId: "turn",
            completedAtMs: 2,
            item: {
              type: "commandExecution",
              id: "cmd",
              command: "pnpm test",
              cwd: "/repo",
              source: "agent",
              status: "completed",
              aggregatedOutput: "final output",
            },
          },
        } as any,
      ],
    },
    historyLoadedMap: { legacy: true },
  });

  const stop = startSessionTranscriptRetention();
  await flushRetention();
  stop();

  const events = useCodexStore.getState().events.legacy ?? [];
  expect(events.map((event) => event.method)).toEqual([
    "item/agentMessage/delta",
    "item/completed",
  ]);
  expect(events[0]).toMatchObject({
    params: { delta: "visible body" },
  });
  expect(events[1]).toMatchObject({
    params: {
      item: {
        type: "commandExecution",
        aggregatedOutput: "final output",
      },
    },
  });
});
