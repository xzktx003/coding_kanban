vi.mock("@session/services/nativeOperationContext",()=>({readNativeOperationContext:async()=>({namespace:"private-fixture-native-domain",scopeToken:"a".repeat(64)})}));
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ fork: vi.fn(), worktree: vi.fn() }));
vi.mock("@session/services/codexService", () => ({ codexService: { threadFork: api.fork } }));
vi.mock("@session/services/apiAdapt/git", () => ({ gitCreateWorktree: api.worktree }));
import { forkSlashWorktree } from "./slashCommands";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useWorkspaceStore.setState({ cwd: "/project" });
  useCodexStore.setState({ currentThreadId: "source", currentTurnId: null, threads: [{ id: "source", cwd: "/project" } as any] });
  useAgentCenterStore.setState({ cards: [] });
  api.worktree.mockResolvedValue({ worktree_path: "/project-worktree", existed: false });
  api.fork.mockResolvedValue({ id: "forked", cwd: "/project-worktree" });
});
it("passes the new directory into native fork before publishing or activating the target", async () => {
  await forkSlashWorktree("source");
  expect(api.fork).toHaveBeenCalledWith("source", { cwd: "/project-worktree", activate: false,expectedScope:"a".repeat(64) });
  expect(useCodexStore.getState().currentThreadId).toBe("forked");
  expect(useWorkspaceStore.getState().cwd).toBe("/project-worktree");
});
it("keeps a newly selected conversation and project while a worktree request is pending", async () => {
  let finish!: (value: unknown) => void;
  api.worktree.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = forkSlashWorktree("source");
  useCodexStore.setState({ currentThreadId: "other" });
  useWorkspaceStore.setState({ cwd: "/other" });
  finish({ worktree_path: "/project-worktree" });
  await pending;
  expect(useCodexStore.getState().currentThreadId).toBe("other");
  expect(useWorkspaceStore.getState().cwd).toBe("/other");
  expect(useAgentCenterStore.getState().cards.find((card) => card.id === "forked")?.cwd).toBe("/project-worktree");
});
it("does not fork on a new runtime after the original directory creation finished", async () => {
  let finish!: (value: unknown) => void;
  api.worktree.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = forkSlashWorktree("source");
  invalidateCodexOperationScope();
  finish({ worktree_path: "/project-worktree" });
  await expect(pending).rejects.toThrow(/连接或账号/);
  expect(api.fork).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().cwd).toBe("/project");
});
