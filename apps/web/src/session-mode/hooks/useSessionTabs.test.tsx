import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { selectCC, selectCodex } = vi.hoisted(() => ({
  selectCC: vi.fn().mockResolvedValue(undefined),
  selectCodex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./useCCSessionManager", () => ({
  useCCSessionManager: () => ({ handleSessionSelect: selectCC }),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: selectCodex },
}));
import { resetClosedTabs, takeClosedTab } from "../stores/closedSessionTabs";
import { sessionTabSelect } from "../stores/sessionTabSelect";
import { useSessionTabActions, useRestoreSessionTabs } from "./useSessionTabs";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useCodexStore } from "../components/codex/stores";
import { useCCStore } from "../stores/cc";
import { useSessionSplitStore } from "../stores/useSessionSplitStore";

const a = {
  kind: "codex" as const,
  id: "a",
  cwd: "/a",
  worktreePath: "/a/worktree",
};
const b = { kind: "codex" as const, id: "b", cwd: "/b" };
beforeEach(() => {
  vi.clearAllMocks();
  useSessionSplitStore.getState().reset();
  useAgentCenterStore.setState({
    cards: [a, b],
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
    newChatIntent: false,
    sharedTabsInitialized: true,
  });
  useWorkspaceStore.setState({ cwd: "/a" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useCodexStore.setState({ currentThreadId: null, currentTurnId: null });
  resetClosedTabs();
});
it("selects the matching project and composer target together", async () => {
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.selectTab(b));
  expect(useWorkspaceStore.getState().cwd).toBe("/b");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("b");
  expect(selectCodex).toHaveBeenCalledWith("b");
});
it("closing a running tab only navigates to its neighbor, without deleting its worktree or interrupting it", async () => {
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.closeTab(a));
  expect(useAgentCenterStore.getState().cards).toEqual([b]);
  expect(selectCodex).toHaveBeenCalledExactlyOnceWith("b");
  await act(() => result.current.closeTab(b));
  expect(selectCodex).toHaveBeenLastCalledWith(null);
});
it("remembers the most recently closed tab for reopen", async () => {
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.closeTab(b));
  await act(() => result.current.closeTab(a));
  expect(takeClosedTab()).toEqual(a);
  expect(takeClosedTab()).toEqual(b);
  expect(takeClosedTab()).toBeNull();
});
it("reopen uses the registered tab select after the closed tab returns", async () => {
  renderHook(useSessionTabActions);
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.closeTab(b));
  expect(useAgentCenterStore.getState().cards.map((card) => card.id)).toEqual(["a"]);
  const closed = takeClosedTab();
  expect(closed?.id).toBe("b");
  useAgentCenterStore.getState().addAgentCard(closed!, { activate: true });
  await act(() => sessionTabSelect(closed!));
  expect(selectCodex).toHaveBeenLastCalledWith("b");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("b");
});
it("closing an unselected tab preserves the input target", async () => {
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.closeTab(b));
  expect(selectCodex).not.toHaveBeenCalled();
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
});
it("restores the selected tab once, without reopening tabs on background state changes", async () => {
  const { rerender } = renderHook(useRestoreSessionTabs);
  expect(selectCodex).toHaveBeenCalledExactlyOnceWith("a");
  act(() => {
    useAgentCenterStore.getState().removeCard(a);
    useCodexStore.setState({ currentThreadId: "a" });
  });
  rerender();
  expect(useAgentCenterStore.getState().cards).toEqual([b]);
  expect(selectCodex).toHaveBeenCalledTimes(1);
});

it("restores the split layout selection when the input target is missing after reload", async () => {
  useAgentCenterStore.setState({
    cards: [a, b],
    currentAgentCardId: null,
    currentAgentCardKind: null,
    newChatIntent: false,
    sharedTabsInitialized: true,
  });
  useSessionSplitStore.setState({
    tree: {
      type: "group",
      id: "restored-group",
      keys: ["codex:b"],
      selected: "codex:b",
    },
    activeGroupId: "restored-group",
  });

  renderHook(useRestoreSessionTabs);

  expect(selectCodex).toHaveBeenCalledExactlyOnceWith("b");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("b");
});
it("keeps ACP active instead of restoring a saved Codex tab over it", () => {
  useAcpStore.setState({ active: true });
  renderHook(useRestoreSessionTabs);
  expect(selectCodex).not.toHaveBeenCalled();
});
it("switches to a Claude neighbor using its project and leaves the running session registered after close", async () => {
  const cc = { kind: "cc" as const, id: "claude", cwd: "/claude-project" };
  useAgentCenterStore.setState({ cards: [a, cc] });
  const { result } = renderHook(useSessionTabActions);
  await act(() => result.current.closeTab(a));
  expect(selectCC).toHaveBeenCalledWith("claude", "/claude-project");
  expect(useAgentSettingsStore.getState().selectedAgent).toBe("cc");
  expect(useWorkspaceStore.getState().cwd).toBe("/claude-project");
  useCCStore.setState({
    activeSessionId: "claude",
    activeSessionIds: ["claude"],
    isLoading: true,
    sessionLoadingMap: { claude: true },
    messages: [{ type: "user", text: "keep working" }],
  });
  await act(() => result.current.closeTab(cc));
  expect(useCCStore.getState().activeSessionId).toBeNull();
  expect(useCCStore.getState().isLoading).toBe(false);
  expect(useCCStore.getState().activeSessionIds).toContain("claude");
  expect(useCCStore.getState().sessionLoadingMap.claude).toBe(true);
  expect(useCCStore.getState().sessionMessagesMap.claude).toEqual([
    { type: "user", text: "keep working" },
  ]);
});

it("restores a saved selection when shared membership arrives after mount", async () => {
  useAgentCenterStore.setState({
    cards: [],
    detachedCard: null,
    currentAgentCardId: "b",
    currentAgentCardKind: "codex",
    newChatIntent: false,
    sharedTabsInitialized: false,
  });
  const { rerender } = renderHook(useRestoreSessionTabs);
  expect(selectCodex).not.toHaveBeenCalled();
  await act(async () => {
    useAgentCenterStore.setState({
      cards: [a, b],
      sharedTabsInitialized: true,
    });
  });
  rerender();
  expect(selectCodex).toHaveBeenCalledExactlyOnceWith("b");
});
