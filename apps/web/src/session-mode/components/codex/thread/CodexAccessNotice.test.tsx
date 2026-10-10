import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";
import { retryEventStream } from "@session/lib/eventStream";
import { CodexAccessNotice } from "./CodexAccessNotice";
vi.mock("@session/lib/eventStream", () => ({ retryEventStream: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  threadAccess: vi.fn(async () => ({ state: "readonly" })),
}));
afterEach(() => {
  cleanup();
  useSessionSyncStore.setState({
    connection: "connected",
    connectionError: null,
  });
  vi.clearAllMocks();
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
