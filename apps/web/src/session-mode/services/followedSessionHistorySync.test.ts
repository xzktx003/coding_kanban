import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  resume: vi.fn(),
  event: undefined as ((event: any) => void) | undefined,
  open: undefined as (() => void) | undefined,
  resync: undefined as (() => void) | undefined,
  prepared: vi.fn(() => true),
}));
vi.mock("./codexService", () => ({
  codexService: { loadThreadHistory: mock.resume },
}));
vi.mock("../lib/eventStream", () => ({
  openEventStream: (s: {
    onOpen: () => void;
    onResync?: () => void;
    onEvent: (event: any) => void;
  }) => {
    mock.event = s.onEvent;
    mock.open = s.onOpen;
    mock.resync = s.onResync;
    return () => {};
  },
}));
vi.mock("./codexTranscriptActivity", async (original) => ({
  ...(await original<object>()),
  isCodexTranscriptPrepared: mock.prepared,
}));
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCodexStore } from "../components/codex/stores";
import { startFollowedSessionHistorySync } from "./followedSessionHistorySync";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { useSessionPreloadStore } from "./sessionPreloadState";
import { retainCodexTranscript } from "./codexTranscriptActivity";
import { useSessionSplitStore } from "../stores/useSessionSplitStore";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  mock.resume.mockReset();
  mock.resume.mockResolvedValue(undefined);
  mock.prepared.mockReturnValue(true);
  useSessionSplitStore.getState().reset();
  useCodexStore.setState({
    historyLoadedMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
    events: {},
    currentThreadId: "a",
  });
  useCodexDeliveryStore.setState({ entries: {} });
  useSessionSyncStore.setState({ recovering: {} });
  useAgentCenterStore.setState({
    detachedCard: null,
    cards: [
      { kind: "codex", id: "a" },
      { kind: "codex", id: "b" },
    ],
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  });
});
it("keeps background warm publication behind the committed foreground renderer", async () => {
  mock.prepared.mockReturnValue(false);
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((call) => call[0])).toEqual(["a"]);
  mock.prepared.mockReturnValue(true);
  retainCodexTranscript("a")();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
  expect(mock.resume.mock.calls[1][2].priority).toBe("background");
});
it("clears an initial history failure after automatic read-only retry", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  mock.resume.mockRejectedValueOnce(new Error("offline"));
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(useSessionSyncStore.getState().recovering.a).toBe("retrying");
  expect(useSessionPreloadStore.getState().entries["codex:a"]?.phase).toBe(
    "failed",
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  expect(useSessionSyncStore.getState().recovering.a).toBeUndefined();
  expect(useSessionPreloadStore.getState().entries["codex:a"]?.phase).toBe(
    "ready",
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).toHaveBeenCalledTimes(2);
});
it("covers all fifty followed recent pages and cleans the coverage registry on teardown", async () => {
  const cards = Array.from({ length: 50 }, (_, i) => ({
    kind: "codex" as const,
    id: `all-${i}`,
  }));
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: "all-49",
    currentAgentCardKind: "codex",
  });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(50);
  expect(mock.resume.mock.calls[0][0]).toBe("all-49");
  expect(Object.values(useSessionPreloadStore.getState().entries)).toHaveLength(
    50,
  );
  expect(
    Object.values(useSessionPreloadStore.getState().entries).every(
      (entry) => entry.phase === "ready",
    ),
  ).toBe(true);
  stop();
  expect(useSessionPreloadStore.getState().entries).toEqual({});
});
it("reads the newly selected session before the background queue drains", async () => {
  // Observed in the browser: switching sessions took ~14s because four
  // background reads already held every slot, so the session the user is
  // waiting for was issued only after they finished one by one.
  const pending: Array<() => void> = [];
  mock.resume.mockImplementation(
    () => new Promise<void>((resolve) => pending.push(resolve)),
  );
  useAgentCenterStore.setState({
    cards: ["bg1", "bg2", "bg3", "bg4", "bg5", "target"].map((id) => ({
      kind: "codex" as const,
      id,
    })),
    currentAgentCardId: "bg1",
    currentAgentCardKind: "codex",
  });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  // Every slot is now held by a background read that has not settled.
  const beforeSwitch = mock.resume.mock.calls.map((c) => c[0]);
  expect(beforeSwitch).not.toContain("target");

  useAgentCenterStore.setState({ currentAgentCardId: "target" });
  useCodexStore.setState({ currentThreadId: "target" });
  await vi.advanceTimersByTimeAsync(1);

  expect(mock.resume.mock.calls.map((c) => c[0])).toContain("target");
  pending.forEach((resolve) => resolve());
});

it("admits every visible pane ahead of queued background pages without changing the selected target", async () => {
  const releases: Array<() => void> = [];
  mock.resume.mockImplementation(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  useAgentCenterStore.setState({
    cards: ["a", "b", "c", "d", "pane-2", "pane-3", "pane-4"].map((id) => ({
      kind: "codex",
      id,
    })),
  });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  const panes = ["pane-2", "pane-3", "pane-4"].map(retainCodexTranscript);
  try {
    await vi.advanceTimersByTimeAsync(1);
    for (const id of ["pane-2", "pane-3", "pane-4"])
      expect(
        mock.resume.mock.calls.find((call) => call[0] === id)?.[2].priority,
      ).toBe("interactive");
    expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
  } finally {
    panes.forEach((release) => release());
    releases.forEach((resolve) => resolve());
  }
});

it("treats a hidden browser page's saved selection as background demand", async () => {
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  try {
    stop = startFollowedSessionHistorySync();
    await vi.advanceTimersByTimeAsync(1);
    expect(
      mock.resume.mock.calls.every((call) => call[2].priority === "background"),
    ).toBe(true);
  } finally {
    visibility.mockRestore();
  }
});

it("preloads the restored visible window targets before unrelated background tabs mount", async () => {
  const releases: Array<() => void> = [];
  mock.resume.mockImplementation(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  const group = (id: string, key: string) => ({
    type: "group" as const,
    id,
    keys: [key],
    selected: key,
  });
  useSessionSplitStore.setState({
    activeGroupId: "primary",
    tree: {
      type: "split",
      id: "split",
      direction: "horizontal",
      ratio: 50,
      first: group("primary", "codex:a"),
      second: group("other", "codex:visible-target"),
    },
  });
  useAgentCenterStore.setState({
    cards: ["a", "background", "visible-target"].map((id) => ({
      kind: "codex",
      id,
    })),
  });
  stop = startFollowedSessionHistorySync();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.resume.mock.calls.map((call) => call[0])).toEqual([
      "a",
      "visible-target",
      "background",
    ]);
    expect(mock.resume.mock.calls[1][2].priority).toBe("interactive");
  } finally {
    releases.forEach((resolve) => resolve());
  }
});

it("keeps non-current restored phone window groups in the background lane", async () => {
  const previousWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 393,
  });
  useSessionSplitStore.setState({
    activeGroupId: "phone-current",
    tree: {
      type: "split",
      id: "phone-split",
      direction: "horizontal",
      ratio: 50,
      first: {
        type: "group",
        id: "phone-current",
        keys: ["codex:a"],
        selected: "codex:a",
      },
      second: {
        type: "group",
        id: "phone-other",
        keys: ["codex:b"],
        selected: "codex:b",
      },
    },
  });
  stop = startFollowedSessionHistorySync();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(
      mock.resume.mock.calls.find((call) => call[0] === "b")?.[2].priority,
    ).toBe("background");
  } finally {
    if (previousWidth)
      Object.defineProperty(window, "innerWidth", previousWidth);
  }
});

it("clears failed initial recovery on teardown without leaving a stale notice", async () => {
  mock.resume.mockRejectedValue(new Error("offline"));
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(useSessionSyncStore.getState().recovering.a).toBe("retrying");
  stop();
  expect(useSessionSyncStore.getState().recovering).toEqual({});
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});
it("loads all followed histories even with partial events, without selecting them", async () => {
  useCodexStore.setState({ events: { b: [] } });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls).toEqual([
    [
      "a",
      undefined,
      {
        background: true,
        recent: true,
        priority: "interactive",
        signal: expect.any(AbortSignal),
        reportScopeChanges: true,
      },
    ],
    [
      "b",
      undefined,
      {
        background: true,
        recent: true,
        priority: "background",
        signal: expect.any(AbortSignal),
        reportScopeChanges: true,
      },
    ],
  ]);
  expect(useCodexStore.getState().currentThreadId).toBe("a");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
});
it("limits concurrent loads and skips a queued tab removed while waiting", async () => {
  useAgentCenterStore.setState({
    cards: ["a", "b", "c", "d", "e", "f"].map((id) => ({ kind: "codex", id })),
  });
  const releases: Array<() => void> = [];
  mock.resume.mockImplementation(
    () => new Promise<void>((r) => releases.push(r)),
  );
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(4);
  useAgentCenterStore.setState({
    cards: ["a", "b", "c", "d", "f"].map((id) => ({ kind: "codex", id })),
  });
  releases[0]();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual([
    "a",
    "b",
    "c",
    "d",
    "f",
  ]);
  stop();
  releases.forEach((r) => r());
  await vi.advanceTimersByTimeAsync(10000);
  expect(mock.resume).toHaveBeenCalledTimes(5);
});
it("retries failures and refreshes on reconnect without endless repeated successes", async () => {
  mock.resume.mockRejectedValueOnce(new Error("offline"));
  stop = startFollowedSessionHistorySync();
  mock.open?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.resume).toHaveBeenCalledTimes(3);
  mock.open?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(20000);
  expect(mock.resume).toHaveBeenCalledTimes(5);
});
it("loads late membership and retries an in-flight refresh after another reconnect", async () => {
  useAgentCenterStore.setState({ cards: [] });
  let release!: () => void;
  mock.resume.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  stop = startFollowedSessionHistorySync();
  mock.open?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).not.toHaveBeenCalled();
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  await vi.advanceTimersByTimeAsync(1);
  mock.open?.();
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
});
it("returning from an external client refreshes history without selecting a session", async () => {
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  const initial = mock.resume.mock.calls.length;
  await vi.advanceTimersByTimeAsync(6000);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.length).toBe(initial + 2);
  expect(
    mock.resume.mock.calls.slice(initial).every((call) => call[2].background),
  ).toBe(true);
  stop();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.length).toBe(initial + 2);
});

it("repairs an accepted receipt without a native echo even when SSE never reports an error", async () => {
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexDeliveryStore.setState({
    entries: {
      receipt: {
        id: "receipt",
        threadId: "a",
        turnId: "new",
        status: "sent",
        text: "kept",
        images: [],
      },
    },
  });
  await vi.advanceTimersByTimeAsync(4100);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a"]);
  useCodexDeliveryStore.setState({ entries: {} });
  mock.resume.mockClear();
  await vi.advanceTimersByTimeAsync(20000);
  expect(mock.resume).not.toHaveBeenCalled();
});
it("does not poll full history while a running turn is quiet, and still responds to stream gaps", async () => {
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
  });
  await vi.advanceTimersByTimeAsync(20000);
  expect(mock.resume).not.toHaveBeenCalled();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  await vi.advanceTimersByTimeAsync(40000);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a"]);
  mock.resume.mockClear();
  await vi.advanceTimersByTimeAsync(40000);
  expect(mock.resume).not.toHaveBeenCalled();
  mock.resync?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
});

it("repairs once when a followed turn completes without returning to quiet polling", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexStore.setState({
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "inProgress",
        startedAtMs: Date.now(),
        durationMs: null,
      },
    },
  });
  mock.event?.({
    event: "codex:notification",
    payload: {
      method: "turn/completed",
      params: {
        threadId: "a",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a"]);
  mock.resume.mockClear();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).not.toHaveBeenCalled();
});

it("repairs once when status changes from active to idle even if turn timing stays stale", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "inProgress",
        startedAtMs: Date.now(),
        durationMs: null,
      },
    },
  });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "inProgress",
        startedAtMs: Date.now(),
        durationMs: null,
      },
    },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a"]);
  mock.resume.mockClear();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).not.toHaveBeenCalled();
});

it("queues one completion repair after an in-flight read from events or status edges", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  let release!: () => void;
  mock.resume.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(1);
  mock.event?.({
    event: "codex:notification",
    payload: {
      method: "turn/completed",
      params: {
        threadId: "a",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);

  mock.resume.mockClear();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "inProgress",
        startedAtMs: Date.now(),
        durationMs: null,
      },
    },
  });
  mock.resume.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  mock.resync?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(1);
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {
      a: {
        turnId: "turn-1",
        status: "completed",
        startedAtMs: Date.now(),
        durationMs: 1000,
      },
    },
  });
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).toHaveBeenCalledTimes(2);
});

it("history recovery marks a missed completion unread once but never old cold-start or rollback history", async () => {
  const { useSessionAttentionStore } =
    await import("../stores/useSessionAttentionStore");
  useSessionAttentionStore.setState({ receipts: {} });
  const turn = (
    turnId: string,
    status: "completed" | "inProgress",
    startedAtMs: number,
  ) => ({ turnId, status, startedAtMs, durationMs: 10 });
  mock.resume.mockImplementation(async (id: string) => {
    useCodexStore.setState((s) => ({
      historyLoadedMap: { ...s.historyLoadedMap, [id]: true },
      turnTimingMap: { ...s.turnTimingMap, [id]: turn("old", "completed", 1) },
    }));
  });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(useSessionAttentionStore.getState().receipts).toEqual({});
  useCodexStore.setState((s) => ({
    turnTimingMap: { ...s.turnTimingMap, a: turn("new", "inProgress", 2) },
  }));
  mock.resume.mockImplementation(async (id: string) => {
    if (id === "a")
      useCodexStore.setState((s) => ({
        turnTimingMap: { ...s.turnTimingMap, a: turn("new", "completed", 2) },
      }));
  });
  mock.resync?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(
    useSessionAttentionStore
      .getState()
      .receipts["codex:a"].completed.map((r) => r.id),
  ).toEqual(["new"]);
  mock.resume.mockImplementation(async (id: string) => {
    if (id === "a")
      useCodexStore.setState((s) => ({
        turnTimingMap: { ...s.turnTimingMap, a: turn("old", "completed", 1) },
      }));
  });
  mock.resync?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(
    useSessionAttentionStore
      .getState()
      .receipts["codex:a"].completed.map((r) => r.id),
  ).toEqual(["new"]);
});
it("failed repairs back off, manual sync retries, and removed/detached tabs retain correct ownership", async () => {
  const { requestSessionHistorySync, useSessionSyncStore } =
    await import("../stores/useSessionSyncStore");
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  mock.resume.mockRejectedValue(new Error("offline"));
  requestSessionHistorySync("a");
  await vi.advanceTimersByTimeAsync(1);
  expect(useSessionSyncStore.getState().recovering.a).toBe("retrying");
  await vi.advanceTimersByTimeAsync(4999);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  mock.resume.mockResolvedValue(undefined);
  requestSessionHistorySync("a");
  await vi.advanceTimersByTimeAsync(1);
  expect(useSessionSyncStore.getState().recovering.a).toBeUndefined();
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "b" }],
    detachedCard: { kind: "codex", id: "a" },
  });
  requestSessionHistorySync("a");
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.at(-1)?.[0]).toBe("a");
});

it("a manual retry during an in-flight failed read is not delayed by the old request's backoff", async () => {
  const { requestSessionHistorySync } =
    await import("../stores/useSessionSyncStore");
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  let reject!: (error: Error) => void;
  mock.resume.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  requestSessionHistorySync("a");
  await vi.advanceTimersByTimeAsync(1);
  requestSessionHistorySync("a");
  reject(new Error("late failure"));
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
});
it("coalesces a foreground event burst without idle cached-tab polling", async () => {
  useCodexStore.setState({ historyLoadedMap: { a: true, b: true } });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(mock.resume).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).not.toHaveBeenCalled();
});
it("measures freshness after a successful slow read completes", async () => {
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
  });
  let release!: () => void;
  mock.resume.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(12000);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(mock.resume.mock.calls.filter((c) => c[0] === "a")).toHaveLength(1);
});

it("healthy streaming and later silence do not refetch running history", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
  });
  for (let i = 0; i < 7; i++) {
    mock.event?.({ payload: { params: { threadId: "a" } } });
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(mock.resume).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.resume).not.toHaveBeenCalled();
});
