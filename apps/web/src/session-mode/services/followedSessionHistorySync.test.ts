import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  resume: vi.fn(),
  open: undefined as (() => void) | undefined,
}));
vi.mock("./codexService", () => ({
  codexService: { threadResume: mock.resume },
}));
vi.mock("../lib/eventStream", () => ({
  openEventStream: (s: { onOpen: () => void }) => {
    mock.open = s.onOpen;
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
    events: {},
    currentThreadId: "a",
  });
  useAgentCenterStore.setState({
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
    ["a", undefined, { background: true }],
    ["b", undefined, { background: true }],
  ]);
  expect(useCodexStore.getState().currentThreadId).toBe("a");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
});
it("limits concurrent loads and skips a queued tab removed while waiting", async () => {
  useAgentCenterStore.setState({
    cards: ["a", "b", "c", "d"].map((id) => ({ kind: "codex", id })),
  });
  const releases: Array<() => void> = [];
  mock.resume.mockImplementation(
    () => new Promise<void>((r) => releases.push(r)),
  );
  stop = startFollowedSessionHistorySync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume).toHaveBeenCalledTimes(2);
  useAgentCenterStore.setState({
    cards: ["a", "b", "d"].map((id) => ({ kind: "codex", id })),
  });
  releases[0]();
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.resume.mock.calls.map((c) => c[0])).toEqual(["a", "b", "d"]);
  stop();
  releases.forEach((r) => r());
  await vi.advanceTimersByTimeAsync(10000);
  expect(mock.resume).toHaveBeenCalledTimes(3);
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
