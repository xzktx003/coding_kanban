import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSessionReadReceipt, useAttentionStorageSync } from "./useSessionReadReceipt";
import { startSessionManagementSync } from "../services/sessionManagementClient";
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

test("shared management wakes its scoped server sync instead of merging another page's unscoped attention", async () => {
  vi.useFakeTimers();
  localStorage.clear();
  let requests = 0;
  const snapshot = { revision: 0, operationWindow: { id: "w", expiresAt: Date.now() + 60_000 }, namespaces: { codex: "account-a", cc: "board", acp: "board" }, entries: [] };
  const close = startSessionManagementSync(async () => { requests++; return new Response(JSON.stringify(snapshot)); }, 1000);
  const rehydrate = vi.spyOn(useSessionAttentionStore.persist, "rehydrate").mockImplementation(async () => {});
  const { unmount } = renderHook(() => useAttentionStorageSync());
  try {
    await act(async () => vi.advanceTimersByTimeAsync(10));
    const before = requests;
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "kanban.session.attention" })));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(rehydrate).not.toHaveBeenCalled();
    expect(requests).toBeGreaterThan(before);
  } finally { unmount(); close(); vi.useRealTimers(); vi.restoreAllMocks(); }
});

test("local-only deployments keep the existing attention storage recovery", () => {
  const rehydrate = vi.spyOn(useSessionAttentionStore.persist, "rehydrate").mockImplementation(async () => {});
  const { unmount } = renderHook(() => useAttentionStorageSync());
  try {
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "kanban.session.attention" })));
    expect(rehydrate).toHaveBeenCalledOnce();
  } finally { unmount(); vi.restoreAllMocks(); }
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
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTimeAsync(300));
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

test("manual unread during a visibility dwell is not immediately undone without a new reading entry", async () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  root.className = "session-mode";
  const marker = document.createElement("div");
  root.append(marker);
  document.body.append(root);
  try {
    useSessionAttentionStore.getState().complete("codex", "a", "reply");
    const { unmount } = renderHook(() =>
      useSessionReadReceipt("codex", "a", { current: marker }),
    );
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    act(() => {
      useSessionAttentionStore.getState().markUnread("codex", "a");
    });
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(
      latestUnread(useSessionAttentionStore.getState().receipts["codex:a"]),
    ).toBe("reply");
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => intersect([{ isIntersecting: true }]));
    await act(async () => vi.advanceTimersByTimeAsync(300));
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
