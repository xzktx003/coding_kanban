import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores";
import { useSubagentStore } from "@session/features/subagents/store";
const inspect = vi.hoisted(() => vi.fn());
vi.mock("@session/features/subagents/service", () => ({
  subagentService: { inspectIdentity: inspect },
}));
import { useCodexThreadInput } from "./useCodexThreadInput";
beforeEach(() => {
  vi.useFakeTimers();
  inspect.mockReset();
  useCodexStore.setState({ threads: [] });
  useSubagentStore.setState({
    nodes: {},
    identities: {},
    identityChecks: {},
    runtimeEpoch: 0,
  });
});
afterEach(() => vi.useRealTimers());
const suspect = () =>
  useSubagentStore.setState({
    nodes: {
      suspect: {
        thread: { id: "suspect" },
        parentId: "root",
        verified: false,
        revision: 0,
      },
    },
  });
it("child clues discovered after mounting trigger a bounded read and one retry", async () => {
  inspect.mockResolvedValue({ id: "suspect" });
  const { result } = renderHook(() => useCodexThreadInput("suspect"));
  expect(inspect).not.toHaveBeenCalled();
  act(suspect);
  await act(async () => Promise.resolve());
  expect(result.current.reason).toContain("尚未确认");
  expect(result.current.reason).not.toContain("由主 Agent");
  expect(inspect).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(inspect).toHaveBeenCalledTimes(2);
  act(() => result.current.recheck());
  await act(async () => Promise.resolve());
  expect(inspect).toHaveBeenCalledTimes(3);
});
it("unmount cancels the metadata consumer and its retry timer", async () => {
  suspect();
  inspect.mockRejectedValue(new Error("offline"));
  const { unmount } = renderHook(() => useCodexThreadInput("suspect"));
  await act(async () => Promise.resolve());
  const signal = inspect.mock.calls[0][1] as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(inspect).toHaveBeenCalledTimes(1);
});
it("a fresh main source corrects the observation without any metadata read or target change", () => {
  suspect();
  useCodexStore.setState({
    threads: [{ id: "suspect", source: "vscode", parentThreadId: null }] as any,
    currentThreadId: "original",
  });
  const { result } = renderHook(() => useCodexThreadInput("suspect"));
  expect(result.current.blocked).toBe(false);
  expect(useSubagentStore.getState().nodes.suspect).toBeUndefined();
  expect(useCodexStore.getState().currentThreadId).toBe("original");
  expect(inspect).not.toHaveBeenCalled();
});

it("a preserved mounted input cancels metadata and retries while the session mode is hidden", async () => {
  suspect();
  inspect.mockRejectedValue(new Error("offline"));
  const root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
  try {
    renderHook(() => useCodexThreadInput("suspect"));
    await act(async () => Promise.resolve());
    const signal = inspect.mock.calls[0][1] as AbortSignal;
    act(() => {
      root.hidden = true;
      window.dispatchEvent(new Event("workbench-mode-changed"));
    });
    expect(signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(inspect).toHaveBeenCalledTimes(1);
    act(() => {
      root.hidden = false;
      window.dispatchEvent(new Event("workbench-mode-changed"));
    });
    await act(async () => Promise.resolve());
    expect(inspect).toHaveBeenCalledTimes(2);
  } finally {
    root.remove();
  }
});
