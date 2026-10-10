import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { startFollowedSessionStatusSync } from "./followedSessionStatusSync";
import {
  useApprovalStore,
  useRequestUserInputStore,
} from "../components/codex/stores";

const stream = vi.hoisted(() => ({
  onOpen: undefined as (() => void) | undefined,
  close: vi.fn(),
  repair: vi.fn(),
}));
vi.mock("../lib/eventStream", () => ({
  reconcileEventStream: stream.repair,
  openEventStream: (subscriber: { onOpen: () => void }) => {
    stream.onOpen = subscriber.onOpen;
    return stream.close;
  },
}));
vi.mock("../hooks/runtime", () => ({
  buildUrl: (path: string) => path,
  authHeaders: () => ({}),
}));
const active = { type: "active" as const, activeFlags: [] };
const idle = { type: "idle" as const };
let stop: (() => void) | undefined;
const response = (data: unknown[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ data, nextCursor }));
beforeEach(() => {
  vi.useFakeTimers();
  stream.close.mockClear();
  stream.repair.mockClear();
  useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
  useRequestUserInputStore.setState({ pendingRequests: [] });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a", cwd: "/first" },
      { kind: "codex", id: "b", cwd: "/second" },
    ],
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  });
  useCodexStore.setState({
    threadStatusMap: {},
    threads: [],
    currentThreadId: "a",
    activeThreadIds: [],
    events: {},
    turnTimingMap: {},
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

it("restores all followed statuses across projects and pages without changing navigation or resuming", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response(
        [
          { id: "outside", status: active },
          { id: "a", status: idle },
        ],
        "page2",
      ),
    )
    .mockResolvedValueOnce(response([{ id: "b", status: active }]));
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(useCodexStore.getState().threadStatusMap).toEqual({
    a: idle,
    b: active,
  });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/codex/thread/list",
    "/api/codex/thread/list",
  ]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    cwd: null,
    modelProviders: null,
    useStateDbOnly: true,
  });
  expect(JSON.parse(fetcher.mock.calls[1][1].body).cursor).toBe("page2");
  expect(useCodexStore.getState()).toMatchObject({
    currentThreadId: "a",
    activeThreadIds: [],
    events: {},
    threads: [],
  });
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
});
it("recovers missing pending-question snapshots without resending answers", async () => {
  const fetcher = vi.fn(async () =>
    response([
      {
        id: "a",
        status: { type: "active", activeFlags: ["waitingOnUserInput"] },
      },
      { id: "b", status: idle },
    ]),
  );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(600);
  expect(stream.repair).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);
  expect(stream.repair).toHaveBeenCalledOnce();
});
it("does not reconnect if the actual pending request arrives during the reconciliation grace period", async () => {
  const fetcher = vi.fn(async () =>
    response([
      {
        id: "a",
        status: { type: "active", activeFlags: ["waitingOnUserInput"] },
      },
      { id: "b", status: idle },
    ]),
  );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  useRequestUserInputStore.setState({
    pendingRequests: [{ threadId: "a", requestId: 7, turnId: "t" } as any],
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(stream.repair).not.toHaveBeenCalled();
});

it("synchronizes membership restored after startup and ignores metadata-only updates", async () => {
  useAgentCenterStore.setState({ cards: [] });
  const fetcher = vi
    .fn()
    .mockImplementation(async () => response([{ id: "b", status: active }]));
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).not.toHaveBeenCalled();
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "b" }] });
  await vi.advanceTimersByTimeAsync(1);
  expect(useCodexStore.getState().threadStatusMap.b).toEqual(active);
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "b", preview: "new title" }],
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("refreshes on SSE reconnect and foreground recovery", async () => {
  const fetcher = vi.fn().mockImplementation(async () =>
    response([
      { id: "a", status: idle },
      { id: "b", status: active },
    ]),
  );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  stream.onOpen?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  const beforeWake = fetcher.mock.calls.length;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(beforeWake);
});

it("does not overwrite a newer streamed status with a delayed snapshot", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  useCodexStore.getState().addEvent("b", {
    method: "thread/status/changed",
    params: { threadId: "b", status: idle },
  });
  resolve(
    response([
      { id: "a", status: idle },
      { id: "b", status: active },
    ]),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(useCodexStore.getState().threadStatusMap).toEqual({
    a: idle,
    b: idle,
  });
});

it("retries a failed query without clearing known statuses", async () => {
  useCodexStore.setState({ threadStatusMap: { a: active } });
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(async () =>
      response([
        { id: "a", status: idle },
        { id: "b", status: active },
      ]),
    );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(useCodexStore.getState().threadStatusMap.a).toEqual(active);
  await vi.advanceTimersByTimeAsync(5000);
  expect(useCodexStore.getState().threadStatusMap).toEqual({
    a: idle,
    b: active,
  });
});

it("checks archived history for missing followed threads and stops once all are found", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([{ id: "a", status: idle }]))
    .mockResolvedValueOnce(
      response([{ id: "b", status: { type: "notLoaded" } }], "unused"),
    );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(useCodexStore.getState().threadStatusMap.b).toEqual({
    type: "notLoaded",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).archived).toBe(true);
});

it("aborts on cleanup and rejects late updates and reconnect callbacks", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(
    (_url, _init) =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  stop();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(
    response([
      { id: "a", status: active },
      { id: "b", status: active },
    ]),
  );
  stream.onOpen?.();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(useCodexStore.getState().threadStatusMap).toEqual({});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(stream.close).toHaveBeenCalledOnce();
  stop = undefined;
});

it("ignores removed tabs in a delayed response and queues newly followed tabs without parallel requests", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockImplementation(async () =>
      response([
        { id: "a", status: idle },
        { id: "c", status: active },
      ]),
    );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a" },
      { kind: "codex", id: "c" },
    ],
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledOnce();
  resolve(
    response([
      { id: "a", status: idle },
      { id: "b", status: active },
    ]),
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(useCodexStore.getState().threadStatusMap).toEqual({
    a: idle,
    c: active,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not query or invent Codex status for a Claude-only tab collection", async () => {
  useAgentCenterStore.setState({ cards: [{ kind: "cc", id: "a" }] });
  const fetcher = vi.fn();
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).not.toHaveBeenCalled();
  expect(useCodexStore.getState().threadStatusMap).toEqual({});
});

it("rejects malformed status and repeated pagination cursors without an infinite query loop", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () =>
      response([{ id: "a", status: { type: "active" } }], "same"),
    );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(useCodexStore.getState().threadStatusMap).toEqual({});
});

it("rechecks a snapshot invalidated only by a turn event instead of leaving status unknown", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(
      response([
        { id: "a", status: active },
        { id: "b", status: idle },
      ]),
    );
  stop = startFollowedSessionStatusSync(fetcher);
  await vi.advanceTimersByTimeAsync(1);
  useCodexStore.getState().addEvent("a", {
    method: "turn/started",
    params: {
      threadId: "a",
      turn: {
        id: "new",
        status: "inProgress",
        items: [],
        itemsView: "full",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });
  resolve(
    response([
      { id: "a", status: idle },
      { id: "b", status: idle },
    ]),
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(useCodexStore.getState().threadStatusMap.a).toEqual(active);
});

it("announces idle external history changes from thread-list timestamps without polling full history", async () => {
  const reconcile = vi.fn();
  window.addEventListener("session-history-reconcile", reconcile);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([
        { id: "a", status: idle, updatedAt: 10 },
        { id: "b", status: idle, updatedAt: 20 },
      ]),
    )
    .mockResolvedValueOnce(
      response([
        { id: "a", status: idle, updatedAt: 11 },
        { id: "b", status: idle, updatedAt: 20 },
      ]),
    )
    .mockResolvedValueOnce(
      response([
        { id: "a", status: idle, updatedAt: 11 },
        { id: "b", status: idle, updatedAt: 20 },
      ]),
    );
  try {
    stop = startFollowedSessionStatusSync(fetcher);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).not.toHaveBeenCalled();

    stream.onOpen?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile.mock.calls[0][0]).toMatchObject({ detail: "a" });

    stream.onOpen?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("session-history-reconcile", reconcile);
  }
});

it("does not announce active progress timestamp changes as history reconciles", async () => {
  const reconcile = vi.fn();
  window.addEventListener("session-history-reconcile", reconcile);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([{ id: "a", status: active, updatedAt: 10 }]),
    )
    .mockResolvedValueOnce(
      response([{ id: "a", status: active, updatedAt: 11 }]),
    );
  try {
    stop = startFollowedSessionStatusSync(fetcher);
    await vi.advanceTimersByTimeAsync(1);
    useCodexStore.setState({
      turnTimingMap: {
        a: {
          turnId: "turn-a",
          status: "inProgress",
          startedAtMs: 1,
          durationMs: null,
        },
      },
    });
    stream.onOpen?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("session-history-reconcile", reconcile);
  }
});

it("repairs a missed active edge once per turn when an unchanged idle snapshot contradicts live timing", async () => {
  const reconcile = vi.fn();
  window.addEventListener("session-history-reconcile", reconcile);
  useCodexStore.setState({
    threadStatusMap: { a: idle, b: idle },
    turnTimingMap: {
      a: {
        turnId: "brief",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  const fetcher = vi.fn(async () =>
    response([
      { id: "a", status: idle },
      { id: "b", status: idle },
    ]),
  );
  try {
    stop = startFollowedSessionStatusSync(fetcher);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].detail).toBe("a");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    useCodexStore.setState({
      turnTimingMap: {
        a: {
          turnId: "next",
          status: "inProgress",
          startedAtMs: 2,
          durationMs: null,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("session-history-reconcile", reconcile);
  }
});
