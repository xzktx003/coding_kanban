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
