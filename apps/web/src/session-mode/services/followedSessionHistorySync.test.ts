import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  resume: vi.fn(),
  event: undefined as ((event: any) => void) | undefined,
  open: undefined as (() => void) | undefined,
  resync: undefined as (() => void) | undefined,
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
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCodexStore } from "../components/codex/stores";
import { startFollowedSessionHistorySync } from "./followedSessionHistorySync";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  mock.resume.mockReset();
  mock.resume.mockResolvedValue(undefined);
  useCodexStore.setState({
    historyLoadedMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
    events: {},
    currentThreadId: "a",
  });
  useCodexDeliveryStore.setState({ entries: {} });
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
      { background: true, recent: true, signal: expect.any(AbortSignal) },
    ],
    [
      "b",
      undefined,
      { background: true, recent: true, signal: expect.any(AbortSignal) },
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
it("repairs a silent running turn, stops at terminal history, and responds to stream gaps", async () => {
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  useCodexStore.setState({
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a"]);
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  mock.resume.mockClear();
  await vi.advanceTimersByTimeAsync(15000);
  expect(mock.resume).not.toHaveBeenCalled();
  mock.resync?.();
  await vi.advanceTimersByTimeAsync(1);
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
it("checks idle cached tabs periodically and coalesces a foreground event burst", async () => {
  useCodexStore.setState({ historyLoadedMap: { a: true, b: true } });
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  mock.resume.mockClear();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(mock.resume).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  expect(new Set(mock.resume.mock.calls.map((c) => c[0]))).toEqual(
    new Set(["a", "b"]),
  );
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

it("healthy streaming does not refetch running history but silence still repairs", async () => {
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
  await vi.advanceTimersByTimeAsync(5000);
  expect(mock.resume).toHaveBeenCalledTimes(1);
});
