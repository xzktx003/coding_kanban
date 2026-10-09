import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApprovalStore } from "../components/codex/stores";
import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cachedTranscriptBaselines } from "./sessionCacheState";
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
});
afterEach(() => vi.useRealTimers());
it("releases already retained old turns to a low watermark and restores history access", () => {
  const events = Array.from({ length: 80 }, (_, i) =>
    message(`turn-${i}`, `${i}:` + "x".repeat(80_000)),
  );
  useCodexStore.setState({
    events: { active: events },
    turnTimingMap: {
      active: {
        turnId: "turn-79",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  useSessionSyncStore.setState({ cursors: { active: null } });
  cachedTranscriptBaselines.set("active", events);
  const result = releaseSessionMemory();
  const retained = useCodexStore.getState().events.active;
  expect(retained.length).toBeLessThan(40);
  expect(retained.at(-1)).toEqual(events.at(-1));
  expect(result.afterBytes).toBeLessThan(result.beforeBytes / 2);
  expect(cachedTranscriptBaselines.has("active")).toBe(false);
  expect(useSessionSyncStore.getState().cursors.active).toBeTruthy();
  expect(useCodexStore.getState().turnTimingMap.active.status).toBe(
    "inProgress",
  );
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
  useCodexStore.setState({ events: { active: events } });
  vi.advanceTimersByTime(5000);
  expect(useCodexStore.getState().events.active.length).toBeLessThan(40);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  useCodexStore.setState({ events: { active: events } });
  vi.advanceTimersByTime(10_000);
  expect(useCodexStore.getState().events.active).toBe(events);
});
it("uses a smaller low-water budget under browser heap pressure without touching approvals", () => {
  const approvals = [
    { requestId: "pending", threadId: "active", turnId: "turn-34" },
  ] as any;
  useApprovalStore.setState({ pendingApprovals: approvals });
  const events = Array.from({ length: 35 }, (_, i) =>
    message(`turn-${i}`, `${i}:` + "x".repeat(80000)),
  );
  useCodexStore.setState({ events: { active: events } });
  releaseSessionMemory();
  expect(useCodexStore.getState().events.active).toBe(events);
  const result = releaseSessionMemory({ pressure: true });
  expect(result.afterBytes).toBeLessThan(2 * 1024 * 1024);
  expect(useCodexStore.getState().currentThreadId).toBe("active");
  expect(useApprovalStore.getState().pendingApprovals).toBe(approvals);
});
it("shrinks display history on high ingress even when the browser heap sample stays low", async () => {
  const { recordTranscriptTraffic } = await import("./sessionMemoryPressure");
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 60000);
  useCodexStore.setState({
    events: {
      active: Array.from({ length: 35 }, (_, i) =>
        message(`burst-${i}`, "x".repeat(80000)),
      ),
    },
  });
  recordTranscriptTraffic(16 * 1024 * 1024);
  const result = releaseSessionMemory();
  expect(result.afterBytes).toBeLessThan(2 * 1024 * 1024);
  expect(useCodexStore.getState().currentThreadId).toBe("active");
});
