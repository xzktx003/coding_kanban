import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  stream: vi.fn(),
  visible: true,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { threadGoalGet: mocks.read },
}));
vi.mock("@session/lib/eventStream", () => ({ openEventStream: mocks.stream }));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => mocks.visible,
}));

import { useThreadGoal } from "./useThreadGoal";
import { useCodexStore } from "../stores";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.visible = true;
  mocks.read.mockResolvedValue({ goal: null });
  mocks.stream.mockReturnValue(vi.fn());
  useCodexStore.setState({
    currentThreadId: "a",
    goalMap: {},
    account: null,
    hasAccount: null,
    accountNamespace: null,
    goalScopeVersion: 0,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("reads the visible thread initially, switches precisely, and never reads a new-chat draft", async () => {
  const hook = renderHook<
    ThreadGoal | undefined,
    { threadId: string | null | undefined }
  >(({ threadId }) => useThreadGoal(threadId), {
    initialProps: { threadId: undefined },
  });
  await waitFor(() =>
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ threadId: "a" }),
  );
  hook.rerender({ threadId: "b" });
  await waitFor(() =>
    expect(mocks.read).toHaveBeenLastCalledWith({ threadId: "b" }),
  );
  hook.rerender({ threadId: null });
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(hook.result.current).toBeUndefined();
});

it("recovers on actual reconnect/gap signals without polling or keeping a disposed thread callback alive", async () => {
  vi.useFakeTimers();
  const hook = renderHook(({ threadId }) => useThreadGoal(threadId), {
    initialProps: { threadId: "a" },
  });
  const original = mocks.stream.mock.calls[0][0];
  act(() => original.onOpen());
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  act(() => original.onOpen());
  expect(mocks.read).toHaveBeenCalledTimes(2);
  act(() => original.onResync());
  expect(mocks.read).toHaveBeenCalledTimes(3);
  hook.rerender({ threadId: "b" });
  expect(mocks.read).toHaveBeenLastCalledWith({ threadId: "b" });
  const count = mocks.read.mock.calls.length;
  act(() => {
    original.onOpen();
    original.onResync();
  });
  expect(mocks.read).toHaveBeenCalledTimes(count);
});

it("stops recovery when session interactions are hidden and restores once on return", () => {
  mocks.visible = false;
  const hook = renderHook(() => useThreadGoal());
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
  mocks.visible = true;
  hook.rerender();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ threadId: "a" });
  mocks.visible = false;
  hook.rerender();
  act(() => window.dispatchEvent(new Event("online")));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  mocks.visible = true;
  hook.rerender();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("keeps the public hook result driven by native goal state and ignores read failures", async () => {
  mocks.read.mockRejectedValue(new Error("unavailable"));
  const hook = renderHook(() => useThreadGoal());
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current).toBeUndefined();
  act(() =>
    useCodexStore.setState({
      goalMap: {
        a: { threadId: "a", objective: "observed", status: "paused" } as any,
      },
    }),
  );
  expect(hook.result.current?.objective).toBe("observed");
});

it("a brief hidden interval cannot consume the visible recovery wake", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("visible");
  renderHook(() => useThreadGoal());
  expect(mocks.read).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("rereads the same thread UUID when the authoritative account namespace changes", () => {
  useCodexStore
    .getState()
    .setAccount(
      { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
      "workspace-A",
    );
  renderHook(() => useThreadGoal("a"));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  act(() =>
    useCodexStore
      .getState()
      .setAccount(
        { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
        "workspace-B",
      ),
  );
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.read).toHaveBeenLastCalledWith({ threadId: "a" });
});

it("uses explicit scope observations rather than account object or display-plan changes", () => {
  useCodexStore
    .getState()
    .setAccount(
      { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
      "workspace-A",
    );
  renderHook(() => useThreadGoal("a"));
  act(() =>
    useCodexStore
      .getState()
      .setAccount(
        { type: "chatgpt", email: "other@example.invalid", planType: "pro" },
        "workspace-A",
      ),
  );
  expect(mocks.read).toHaveBeenCalledTimes(1);
  act(() =>
    useCodexStore.setState((state) => ({
      goalScopeVersion: state.goalScopeVersion + 1,
    })),
  );
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
