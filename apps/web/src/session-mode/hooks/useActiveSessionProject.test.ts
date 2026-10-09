import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useActiveSessionProject } from "./useActiveSessionProject";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useCodexStore } from "../components/codex/stores";
import { useCCStore } from "../stores/cc";
beforeEach(() => {
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    currentAgentCardKind: null,
    detachedCard: null,
  });
  useWorkspaceStore.setState({ cwd: "/unrelated" });
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useCodexStore.setState({ currentThreadId: null, threads: [] });
  useCCStore.setState({ activeSessionId: null });
});
it("uses only explicit workspace selection for a new draft", () => {
  expect(renderHook(useActiveSessionProject).result.current.path).toBe(
    "/unrelated",
  );
});
it("does not borrow workspace for existing Codex or Claude with missing metadata", () => {
  useCodexStore.setState({ currentThreadId: "missing" });
  expect(renderHook(useActiveSessionProject).result.current.path).toBeNull();
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useCCStore.setState({ activeSessionId: "missing-cc" });
  expect(renderHook(useActiveSessionProject).result.current.path).toBeNull();
});
it("keeps detached conversation project and actual worktree target", () => {
  useAgentCenterStore.setState({
    currentAgentCardId: "own",
    currentAgentCardKind: "codex",
    detachedCard: {
      kind: "codex",
      id: "own",
      cwd: "/project",
      worktreePath: "/trees/feature",
    },
  });
  expect(renderHook(useActiveSessionProject).result.current).toEqual({
    label: "project · feature",
    path: "/trees/feature",
    projectPath: "/project",
  });
});

it("ACP retains its native session directory when another workspace is browsed", () => {
  useAcpStore.setState({
    active: true,
    sessionId: "native-session",
    sessionCwd: "/native-project",
  } as any);
  expect(renderHook(useActiveSessionProject).result.current.path).toBe(
    "/native-project",
  );
});
it("an existing ACP session with an unknown directory does not borrow the workspace", () => {
  useAcpStore.setState({
    active: true,
    sessionId: "unknown-native",
    sessionCwd: null,
  } as any);
  expect(renderHook(useActiveSessionProject).result.current.path).toBeNull();
});
