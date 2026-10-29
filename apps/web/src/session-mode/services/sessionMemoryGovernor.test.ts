import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApprovalStore } from "../components/codex/stores";
import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cachedTranscriptBaselines } from "./sessionCacheState";
import { memoryHistoryWindows } from "./sessionMemoryHistory";
import {
  releaseSessionMemory,
  startSessionMemoryGovernor,
} from "./sessionMemoryGovernor";
const message = (turnId: string, text = "body") =>
  ({
    method: "item/completed",
    params: {
      threadId: "active",
      turnId,
      item: { id: turnId, type: "agentMessage", text },
    },
  }) as any;
beforeEach(() => {
  useCodexStore.setState({
    events: {},
    threads: [],
    currentThreadId: "active",
    turnTimingMap: {},
    commandStatusMap: {},
    commandDurationMap: {},
  });
  useSessionSyncStore.setState({ cursors: {}, earlierLoading: {} });
  cachedTranscriptBaselines.clear();
  // Pinned reading windows now decide the reading allowance, so leaving one
  // behind would hand the next case an allowance it never asked for.
  memoryHistoryWindows.clear();
});
afterEach(() => vi.useRealTimers());
it("releases already retained old turns to a low watermark and restores history access", () => {
  const events = Array.from({ length: 80 }, (_, i) =>
    message(`turn-${i}`, `${i}:` + "x".repeat(80_000)),
  );
  // A background thread: the thread being read now keeps a larger allowance so
  // paging a long history back is not undone by the byte budget.
  useCodexStore.setState({
    events: { background: events },
    currentThreadId: "other",
    turnTimingMap: {
      background: {
        turnId: "turn-79",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  useSessionSyncStore.setState({ cursors: { background: null } });
  cachedTranscriptBaselines.set("background", events);
  const result = releaseSessionMemory();
  const retained = useCodexStore.getState().events.background;
  expect(retained.length).toBeLessThan(40);
  expect(retained.at(-1)).toEqual(events.at(-1));
  expect(result.afterBytes).toBeLessThan(result.beforeBytes / 2);
  expect(cachedTranscriptBaselines.has("background")).toBe(false);
  expect(useSessionSyncStore.getState().cursors.background).toBeTruthy();
  expect(useCodexStore.getState().turnTimingMap.background.status).toBe(
    "inProgress",
  );
});
function withHeap(fraction: number, run: () => void) {
  const perf = performance as Performance & { memory?: unknown };
  const had = Object.prototype.hasOwnProperty.call(perf, "memory");
  const previous = perf.memory;
  Object.defineProperty(perf, "memory", {
    value: { usedJSHeapSize: 4_000_000_000 * fraction, jsHeapSizeLimit: 4e9 },
    configurable: true,
  });
  try {
    run();
  } finally {
    if (had)
      Object.defineProperty(perf, "memory", {
        value: previous,
        configurable: true,
      });
    else delete (perf as { memory?: unknown }).memory;
  }
}
// Few, very large turns so the retained amount is decided by the byte budget
// rather than by the event-count budget.
function bytesAtHeap(fraction: number) {
  const events = Array.from({ length: 24 }, (_, i) =>
    message(`turn-${i}`, `${i}:` + "x".repeat(600_000)),
  );
  useCodexStore.setState({
    events: { background: events },
    currentThreadId: "other",
    turnTimingMap: {},
  });
  useSessionSyncStore.setState({ cursors: { background: null } });
  let after = 0;
  withHeap(fraction, () => {
    after = releaseSessionMemory().afterBytes;
  });
  return after;
}
it("steps the background byte allowance down by heap level instead of one cliff", () => {
  const calm = bytesAtHeap(0.2);
  const elevated = bytesAtHeap(0.6);
  const high = bytesAtHeap(0.8);
  // One threshold means an elevated heap still gets the full allowance and then
  // drops straight to the tightest tier, which oscillates at the boundary.
  expect(elevated).toBeLessThan(calm);
  expect(high).toBeLessThan(elevated);
});
it("enforces a shared budget across many open transcripts", () => {
  useCodexStore.setState({
    events: Object.fromEntries(
      Array.from({ length: 12 }, (_, n) => [
        `thread-${n}`,
        Array.from({ length: 30 }, (_, i) =>
          message(`turn-${i}`, `${n}:${i}` + "x".repeat(80_000)),
        ),
      ]),
    ),
  });
  const result = releaseSessionMemory();
  expect(result.afterBytes).toBeLessThan(32 * 1024 * 1024);
});
it("cleans orphan command maps and skips rewriting small immutable histories", () => {
  const events = [message("small")];
  useCodexStore.setState({
    events: { active: events },
    commandStatusMap: { stale: "completed" },
    commandDurationMap: { stale: 4 },
  });
  const approvals = [
    { requestId: "pending", threadId: "active", turnId: "turn-34" },
  ] as any;
  useApprovalStore.setState({ pendingApprovals: approvals });
  releaseSessionMemory();
  expect(useCodexStore.getState().events.active).toBe(events);
  expect(useCodexStore.getState().commandStatusMap).toEqual({});
  expect(useCodexStore.getState().commandDurationMap).toEqual({});
  const before = useCodexStore.getState();
  releaseSessionMemory();
  expect(useCodexStore.getState()).toBe(before);
});
it("also releases on a timer without new messages and removes all listeners on teardown", () => {
  vi.useFakeTimers();
  const stop = startSessionMemoryGovernor();
  const events = Array.from({ length: 80 }, (_, i) =>
    message(`turn-${i}`, "x".repeat(80_000)),
  );
  useCodexStore.setState({
    events: { background: events },
    currentThreadId: "other",
  });
  vi.advanceTimersByTime(5000);
  expect(useCodexStore.getState().events.background.length).toBeLessThan(40);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  useCodexStore.setState({ events: { background: events } });
  vi.advanceTimersByTime(10_000);
  expect(useCodexStore.getState().events.background).toBe(events);
});
it("uses a smaller low-water budget under browser heap pressure without touching approvals", () => {
  const approvals = [
    { requestId: "pending", threadId: "active", turnId: "turn-34" },
  ] as any;
  useApprovalStore.setState({ pendingApprovals: approvals });
  const events = Array.from({ length: 35 }, (_, i) =>
    message(`turn-${i}`, `${i}:` + "x".repeat(80000)),
  );
  // Scoped to a background thread: the thread on screen is deliberately
  // unlimited so paging a long history to its start cannot be undone.
  useCodexStore.setState({
    events: { background: events },
    currentThreadId: "other",
  });
  releaseSessionMemory();
  expect(useCodexStore.getState().events.background).toBe(events);
  const result = releaseSessionMemory({ pressure: true });
  expect(result.afterBytes).toBeLessThan(2 * 1024 * 1024);
  expect(useApprovalStore.getState().pendingApprovals).toBe(approvals);
});
it("shrinks display history on high ingress even when the browser heap sample stays low", async () => {
  const { recordTranscriptTraffic } = await import("./sessionMemoryPressure");
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 60000);
  useCodexStore.setState({
    events: {
      background: Array.from({ length: 35 }, (_, i) =>
        message(`burst-${i}`, "x".repeat(80000)),
      ),
    },
    currentThreadId: "other",
  });
  recordTranscriptTraffic(16 * 1024 * 1024);
  const result = releaseSessionMemory();
  expect(result.afterBytes).toBeLessThan(2 * 1024 * 1024);
});

it("keeps a just-recovered history page under heap pressure so paging can make progress", async () => {
  const { pinMemoryHistoryPage, memoryHistoryWindows } = await import(
    "./sessionMemoryHistory"
  );
  memoryHistoryWindows.clear();
  // Matches the observed browser case: a recovery page restores far more events
  // than the pressure ceiling allows, spread over realistically sized turns.
  const recovered = Array.from({ length: 26 }, (_, t) =>
    Array.from({ length: 100 }, (_, i) =>
      message(`recovered-${t}`, `older ${t}/${i}`),
    ),
  ).flat();
  const latest = Array.from({ length: 4 }, (_, i) =>
    message("latest", `newest ${i}`),
  );
  const events = [...recovered, ...latest];
  useCodexStore.setState({ events: { active: events } });
  pinMemoryHistoryPage("active", [
    ...new Set(recovered.map((event) => event.params.turnId)),
  ]);

  releaseSessionMemory({ pressure: true });

  const retained = new Set(useCodexStore.getState().events.active);
  // Dropping the pinned window makes the click a no-op: the page lands and is
  // immediately trimmed back, so the transcript never grows.
  for (const event of recovered) expect(retained.has(event)).toBe(true);
  expect(useCodexStore.getState().events.active.at(-1)).toEqual(events.at(-1));
});

it("keeps the display budget while an earlier page is in flight without cancelling its read or approvals", () => {
  const { pendingApprovals } = useApprovalStore.getState();
  const events = Array.from({ length: 80 }, (_, index) =>
    message(`loading-${index}`, "x".repeat(80000)),
  );
  useCodexStore.setState({ events: { active: events } });
  useSessionSyncStore.setState({
    earlierLoading: { active: true },
    cursors: { active: "native-pending-page" },
  });
  const result = releaseSessionMemory();
  expect(result.afterBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(useSessionSyncStore.getState().earlierLoading.active).toBe(true);
  expect(useSessionSyncStore.getState().cursors.active).toMatch(
    /^kanban-memory-reload:/,
  );
  expect(useApprovalStore.getState().pendingApprovals).toBe(pendingApprovals);
});

it("does not self-trigger repeated publications for an unchanged protected attachment under heap pressure", () => {
  vi.useFakeTimers();
  const previousMemory = Object.getOwnPropertyDescriptor(performance, "memory");
  Object.defineProperty(performance, "memory", {
    configurable: true,
    value: {
      usedJSHeapSize: 300 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    },
  });
  const source = {
    method: "item/completed",
    params: {
      threadId: "active",
      turnId: "live",
      item: {
        type: "userMessage",
        id: "user-with-image",
        clientId: null,
        content: [
          {
            type: "image",
            url: "data:image/png;base64," + "x".repeat(3 * 1024 * 1024),
          },
        ],
      },
    },
  } as any;
  const transcript = [source];
  useCodexStore.setState({ events: { active: transcript } });
  let publications = 0;
  const unsubscribe = useCodexStore.subscribe((state, previous) => {
    if (state.events !== previous.events) publications++;
  });
  const stop = startSessionMemoryGovernor();
  try {
    // No new native or user input. The initial pressure pass must not enqueue
    // its own 250ms retry by publishing an identical array wrapper.
    vi.advanceTimersByTime(2100);
    expect(publications).toBe(0);
    expect(useCodexStore.getState().events.active).toBe(transcript);
    expect(useCodexStore.getState().events.active[0]).toBe(source);
    expect(vi.getTimerCount()).toBe(1); // existing 5-second watchdog only
  } finally {
    stop();
    unsubscribe();
    if (previousMemory)
      Object.defineProperty(performance, "memory", previousMemory);
    else delete (performance as Performance & { memory?: unknown }).memory;
  }
});
