import { renderHook, act } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "../stores";
import { useTurnControl } from "./useTurnControl";
beforeEach(() =>
  useCodexStore.setState({
    currentThreadId: "a",
    currentTurnId: null,
    threads: [],
    threadStatusMap: {},
    turnTimingMap: {},
    events: {},
    retryNoticeMap: {},
  }),
);
it("uses turn progress before status notifications arrive and ignores other sessions", () => {
  const hook = renderHook(() => useTurnControl());
  act(() =>
    useCodexStore.setState({
      turnTimingMap: {
        a: {
          turnId: "turn-a",
          startedAtMs: 1,
          durationMs: null,
          status: "inProgress",
        },
      },
    }),
  );
  expect(hook.result.current).toEqual({ running: true, turnId: "turn-a" });
  act(() => useCodexStore.setState({ currentThreadId: "b" }));
  expect(hook.result.current).toEqual({ running: false, turnId: null });
});
it("returns to send after completion even if the active status is delayed", () => {
  useCodexStore.setState({
    currentTurnId: "old",
    threadStatusMap: { a: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      a: { turnId: "old", startedAtMs: 1, durationMs: 2, status: "completed" },
    },
  });
  const hook = renderHook(() => useTurnControl());
  expect(hook.result.current).toEqual({ running: false, turnId: null });
});

it("does not steer a failed thread even when its last progress snapshot is stale", () => {
  useCodexStore.setState({
    currentTurnId: "old",
    threadStatusMap: { a: { type: "systemError" } },
    turnTimingMap: { a: { turnId: "old", startedAtMs: 1, durationMs: null, status: "inProgress" } },
  });
  const hook = renderHook(() => useTurnControl());
  expect(hook.result.current).toEqual({ running: false, turnId: null });
  act(() => useCodexStore.getState().addEvent("a", {
    method: "turn/started",
    params: { threadId: "a", turn: { id: "retry", status: "inProgress", items: [] } },
  } as any));
  expect(hook.result.current).toEqual({ running: true, turnId: "retry" });
});

it("does not use a stale current turn after a system error without timing", () => {
  useCodexStore.setState({ currentTurnId: "old", threadStatusMap: { a: { type: "systemError" } } });
  expect(renderHook(() => useTurnControl()).result.current).toEqual({ running: false, turnId: null });
});

it("handles a terminal error when the start event was missed", () => {
  useCodexStore.setState({ currentTurnId: "old", threadStatusMap: { a: { type: "active", activeFlags: [] } } });
  const hook = renderHook(() => useTurnControl());
  act(() => useCodexStore.getState().addEvent("a", {
    method: "error", params: { threadId: "a", turnId: "old", willRetry: false, error: { message: "at capacity" } },
  } as any));
  expect(hook.result.current).toEqual({ running: false, turnId: null });
  expect(useCodexStore.getState().currentTurnId).toBeNull();
});

it("keeps retryable errors and late errors for an older turn from ending the current turn", () => {
  useCodexStore.getState().addEvent("a", { method: "turn/started", params: { threadId: "a", turn: { id: "new", status: "inProgress", items: [] } } } as any);
  const hook = renderHook(() => useTurnControl());
  for (const [turnId, willRetry] of [["new", true], ["old", false]] as const) {
    act(() => useCodexStore.getState().addEvent("a", { method: "error", params: { threadId: "a", turnId, willRetry, error: { message: "retry" } } } as any));
    expect(hook.result.current).toEqual({ running: true, turnId: "new" });
  }
});

it("uses the same terminal-state rules for a side thread without borrowing the selected turn", () => {
  useCodexStore.setState({
    currentTurnId: "main-turn",
    threadStatusMap: { b: { type: "active", activeFlags: [] } },
    turnTimingMap: { b: { turnId: "side-turn", startedAtMs: 1, durationMs: 2, status: "failed" } },
  });
  expect(renderHook(() => useTurnControl("b")).result.current).toEqual({ running: false, turnId: null });
  expect(renderHook(() => useTurnControl("c")).result.current).toEqual({ running: false, turnId: null });
});

it("a systemError notification terminates cached progress even if a stale active status follows", () => {
  const add = (event: any) => act(() => useCodexStore.getState().addEvent("a", event));
  add({ method: "turn/started", params: { threadId: "a", turn: { id: "old", status: "inProgress", items: [] } } });
  const hook = renderHook(() => useTurnControl());
  add({ method: "thread/status/changed", params: { threadId: "a", status: { type: "systemError" } } });
  expect(useCodexStore.getState().currentTurnId).toBeNull();
  add({ method: "thread/status/changed", params: { threadId: "a", status: { type: "active", activeFlags: [] } } });
  expect(hook.result.current).toEqual({ running: false, turnId: null });
});
