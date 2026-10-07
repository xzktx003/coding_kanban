import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSessionReadReceipt } from "./useSessionReadReceipt";
import {
  latestUnread,
  useSessionAttentionStore,
} from "../stores/useSessionAttentionStore";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useLayoutStore } from "../stores/useLayoutStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";

let intersect: (entries: Array<{ isIntersecting: boolean }>) => void;
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  useSessionAttentionStore.setState({ receipts: {} });
  useLayoutStore.setState({ view: "agent" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useAgentCenterStore.setState({
    cardsViewMode: "grid",
    currentAgentCardId: "a",
  });
});
test("only the selected, foreground conversation at its latest reply is read", async () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  root.className = "session-mode";
  const marker = document.createElement("div");
  root.append(marker);
  document.body.append(root);
  try {
    useSessionAttentionStore.getState().complete("codex", "a", "first");
    const { unmount } = renderHook(() =>
      useSessionReadReceipt("codex", "a", { current: marker }),
    );
    act(() => intersect([{ isIntersecting: false }]));
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBe("first");
    vi.mocked(document.hasFocus).mockReturnValue(false);
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBe("first");
    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBeNull();
    unmount();
  } finally {
    root.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
test("a visible but unselected grid card and a hidden workbench retain unread", async () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  root.className = "session-mode";
  root.hidden = true;
  const marker = document.createElement("div");
  root.append(marker);
  document.body.append(root);
  try {
    useSessionAttentionStore.getState().complete("codex", "a", "reply");
    const { unmount } = renderHook(() =>
      useSessionReadReceipt("codex", "a", { current: marker }),
    );
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBe("reply");
    act(() => useAgentCenterStore.setState({ currentAgentCardId: "b" }));
    root.hidden = false;
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBe("reply");
    unmount();
  } finally {
    root.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
