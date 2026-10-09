import { beforeEach, expect, test, vi } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  openBuiltinInputTarget,
  selectBuiltinInputTarget,
} from "./builtinInputNavigation";
const reads = vi.hoisted(() => ({ codex: vi.fn(), cc: vi.fn() }));
vi.mock("./codexService", () => ({
  codexService: { setCurrentThread: reads.codex },
}));
vi.mock("./followedSessionAuxSync", () => ({ refreshClaudeHistory: reads.cc }));
beforeEach(() => {
  reads.codex.mockReset().mockResolvedValue(undefined);
  reads.cc.mockReset().mockResolvedValue(undefined);
  useAcpStore.getState().reset();
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "code", cwd: "/code" },
      { kind: "cc", id: "claude", cwd: "/claude" },
    ],
    currentAgentCardId: "code",
    currentAgentCardKind: "codex",
    detachedCard: null,
  });
  useCodexStore.setState({
    currentThreadId: "code",
    activeThreadIds: ["code"],
    events: { code: [] },
  });
  useCCStore.setState({
    activeSessionId: "claude",
    activeSessionIds: ["claude"],
    messages: [],
    sessionMessagesMap: {},
  });
});
test("explicit provider selection aligns focus, sender and project without changing running ownership", () => {
  selectBuiltinInputTarget("cc");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("claude");
  expect(useAgentCenterStore.getState().currentAgentCardKind).toBe("cc");
  expect(useAgentSettingsStore.getState().selectedAgent).toBe("cc");
  expect(useWorkspaceStore.getState().cwd).toBe("/claude");
  expect(useCCStore.getState().activeSessionId).toBe("claude");
  expect(useCCStore.getState().activeSessionIds).toEqual(["claude"]);
  expect(useCodexStore.getState().activeThreadIds).toEqual(["code"]);
  selectBuiltinInputTarget("codex");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("code");
  expect(reads.codex).toHaveBeenCalledWith("code");
});
test("choosing a provider with no followed session opens an empty draft and preserves the prior transcript and execution", () => {
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "code", cwd: "/code" }],
  });
  useCCStore.setState({
    activeSessionId: "claude",
    messages: [{ type: "user", text: "保留历史" }] as any,
    sessionLoadingMap: { claude: true },
  });
  selectBuiltinInputTarget("cc");
  expect(useAgentCenterStore.getState().cards).toHaveLength(1);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBeNull();
  expect(useCCStore.getState().activeSessionId).toBeNull();
  expect(useCCStore.getState().sessionMessagesMap.claude[0]).toEqual({
    type: "user",
    text: "保留历史",
  });
  expect(useCCStore.getState().activeSessionIds).toEqual(["claude"]);
  expect(useCCStore.getState().sessionLoadingMap.claude).toBe(true);
  expect(reads.cc).not.toHaveBeenCalled();
});

test("opening a task history follows its exact target instead of retaining another focused conversation", () => {
  useAgentCenterStore.setState({
    currentAgentCardId: "claude",
    currentAgentCardKind: "cc",
  });
  openBuiltinInputTarget({ kind: "codex", id: "task-run", cwd: "/task" });
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("task-run");
  expect(
    useAgentCenterStore
      .getState()
      .cards.some((c) => c.id === "task-run" && c.kind === "codex"),
  ).toBe(true);
  expect(useWorkspaceStore.getState().cwd).toBe("/task");
  expect(reads.codex).toHaveBeenCalledExactlyOnceWith("task-run");
  expect(useCodexStore.getState().activeThreadIds).toEqual(["code"]);
});
