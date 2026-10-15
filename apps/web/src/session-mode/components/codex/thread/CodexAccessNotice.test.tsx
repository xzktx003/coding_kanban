import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";
import { retryEventStream } from "@session/lib/eventStream";
import { CodexAccessNotice } from "./CodexAccessNotice";
import { useCodexAccessStore, resetCodexAccessCache } from "@session/stores/useCodexAccessStore";
import { threadAccess } from "@session/services/apiAdapt/codex";
vi.mock("@session/lib/eventStream", () => ({ retryEventStream: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  threadAccess: vi.fn(async () => ({ state: "readonly" })),
}));
afterEach(() => {
  cleanup();
  resetCodexAccessCache();
  useSessionSyncStore.setState({
    connection: "connected",
    connectionError: null,
  });
  vi.clearAllMocks();
});
it("keeps the specific history retry clickable by suppressing the overlapping generic notice without stopping access reads", async () => {
  useSessionSyncStore.setState({ connection: "paused", connectionError: "generic recovery error" });
  render(<CodexAccessNotice threadId="a" suppressStatus />);
  expect(screen.queryByText("generic recovery error")).toBeNull();
  await waitFor(() => expect(useCodexAccessStore.getState().entries.a?.access?.state).toBe("readonly"));
});
it("shows a paused stream error and recovers only on explicit retry", async () => {
  useSessionSyncStore.setState({
    connection: "paused",
    connectionError: "会话数据过大，实时接收已暂停",
  });
  const reconcile = vi.fn();
  window.addEventListener("session-history-reconcile", reconcile);
  try {
    render(<CodexAccessNotice threadId="a" />);
    expect(
      await screen.findByText("会话数据过大，实时接收已暂停"),
    ).toBeTruthy();
    expect(retryEventStream).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retryEventStream).toHaveBeenCalledOnce();
    expect(reconcile.mock.calls[0][0].detail).toBe("a");
  } finally {
    window.removeEventListener("session-history-reconcile", reconcile);
  }
});

it.each(["owned", "readonly"])("keeps normal %s lifecycle out of the transcript while observing metadata", async (state) => {
  vi.mocked(threadAccess).mockResolvedValueOnce({ state, reason: "仍有已加载的子 Agent，等待其退出后释放", generation: 1 } as any);
  render(<CodexAccessNotice threadId="normal" />);
  await waitFor(() => expect(useCodexAccessStore.getState().entries.normal?.access?.state).toBe(state));
  expect(screen.queryByText("仍有已加载的子 Agent，等待其退出后释放")).toBeNull();
  expect(screen.queryByText("只读查看，发送时恢复原会话")).toBeNull();
});

it("distinguishes a blocking writer conflict and rechecks metadata without acquiring or retrying a message", async () => {
  vi.mocked(threadAccess).mockResolvedValue({ state: "external", reason: "another writer", generation: 1 });
  render(<CodexAccessNotice threadId="blocked" />);
  expect(await screen.findByText("其他客户端占用 · 历史可读，草稿已保留")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新核对" }));
  await waitFor(() => expect(vi.mocked(threadAccess).mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(vi.mocked(threadAccess).mock.calls.every(([id, release]) => id === "blocked" && release === false)).toBe(true);
  expect(retryEventStream).not.toHaveBeenCalled();
});
