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
import { useSessionTabActions, useRestoreSessionTabs } from "./useSessionTabs";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useCodexStore } from "../components/codex/stores";
import { useCCStore } from "../stores/cc";

const a = {
  kind: "codex" as const,
  id: "a",
  cwd: "/a",
  worktreePath: "/a/worktree",
};
const b = { kind: "codex" as const, id: "b", cwd: "/b" };
beforeEach(() => {
  vi.clearAllMocks();
  useAgentCenterStore.setState({
    cards: [a, b],
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  });
  useWorkspaceStore.setState({ cwd: "/a" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useCodexStore.setState({ currentThreadId: null, currentTurnId: null });
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
