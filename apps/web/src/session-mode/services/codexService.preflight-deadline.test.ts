vi.mock("./nativeOperationContext",()=>({readNativeOperationContext:async()=>({namespace:"private-fixture-native-domain",scopeToken:"a".repeat(64)})}));
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  gitCreateWorktree: vi.fn(),
  threadGoalSet: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
vi.mock("./apiAdapt/codex", () => api);
vi.mock("./apiAdapt/git", () => api);
vi.mock("./apiAdapt/skills", () => api);

import { codexService, resetCodexRuntimeState } from "./codexService";
import { useCodexStore, useConfigStore } from "../components/codex/stores";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useThreadModelStore, flushThreadModelSettings } from "../stores/useThreadModelStore";

const created = {
  thread: { id: "created", cwd: "/project", preview: "", turns: [] },
  model: "native-model",
  modelProvider: "openai",
  reasoningEffort: "high",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  for (let i=localStorage.length-1;i>=0;i--) { const key=localStorage.key(i); if(key?.startsWith("kanban.session.execution")) localStorage.removeItem(key); }
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetCodexRuntimeState();
  useThreadModelStore.setState({ threads: {} });
  useWorkspaceStore.setState({ cwd: "/project" });
  useCodexStore.setState({
    currentThreadId: "selected",
    currentTurnId: null,
    activeThreadIds: [],
    threads: [],
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
  });
  useConfigStore.setState({
    model: "new-chat-default",
    modelProvider: "openai",
    reasoningEffort: "medium",
    threadCwdMode: "local",
  });
  api.threadStart.mockResolvedValue(created);
  api.gitCreateWorktree.mockResolvedValue({ worktree_path: "/worktree" });
});

afterEach(async () => {
  // Settle this case's real IDB hydration before discarding its fake scheduler.
  const settingsSettled = Promise.all(
    Object.keys(useThreadModelStore.getState().threads).map(id => flushThreadModelSettings(id)),
  );
  await vi.runOnlyPendingTimersAsync();
  await settingsSettled;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("bounds a stalled worktree request and never starts a thread from its late result", async () => {
  useConfigStore.setState({ threadCwdMode: "worktree" });
  const worktree = deferred<{ worktree_path: string }>();
  api.gitCreateWorktree.mockReturnValue(worktree.promise);
  const settled = vi.fn();
  const pending = codexService.threadStart().then(settled, settled);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: expect.stringMatching(/创建.*结果未确认.*核对会话列表/),
    }),
  );
  expect(api.gitCreateWorktree.mock.calls[0][2].signal.aborted).toBe(true);
  worktree.resolve({ worktree_path: "/late-worktree" });
  await pending;
  await vi.advanceTimersByTimeAsync(0);
  expect(api.threadStart).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
});

it("bounds a stalled creation even if transport ignores abort and ignores late settings or activation", async () => {
  const creation = deferred<typeof created>();
  api.threadStart.mockReturnValue(creation.promise);
  const shouldActivate = vi.fn(() => true);
  const settled = vi.fn();
  const pending = codexService
    .threadStart({ shouldActivate })
    .then(settled, settled);

  await vi.advanceTimersByTimeAsync(30_000);
  expect(settled).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: expect.stringMatching(/创建.*结果未确认.*核对会话列表/),
    }),
  );
  expect(api.threadStart.mock.calls[0][1].signal.aborted).toBe(true);
  creation.resolve(created);
  await pending;
  await vi.advanceTimersByTimeAsync(0);
  expect(shouldActivate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
  expect(useCodexStore.getState().threads).toEqual([]);
  expect(useThreadModelStore.getState().threads).toEqual({});
  expect(useConfigStore.getState().model).toBe("new-chat-default");
  expect(api.threadStart).toHaveBeenCalledTimes(1);
});

it("bounds a stalled goal update without reporting a late response as success or resending", async () => {
  const goal = deferred<{ goal: { objective: string } }>();
  api.threadGoalSet.mockReturnValue(goal.promise);
  const accepted = vi.fn();
  const rejected = vi.fn();
  const pending = codexService
    .threadGoalSet({ threadId: "selected", objective: "next" })
    .then(accepted, rejected);

  await vi.advanceTimersByTimeAsync(30_000);
  expect(rejected).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: expect.stringMatching(/设置结果未确认.*核对目标状态/),
    }),
  );
  expect(api.threadGoalSet.mock.calls[0][1].signal.aborted).toBe(true);
  goal.resolve({ goal: { objective: "next" } });
  await pending;
  await vi.advanceTimersByTimeAsync(0);
  expect(accepted).not.toHaveBeenCalled();
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
});

it("keeps a successful worktree creation and deferred activation compatible", async () => {
  useConfigStore.setState({ threadCwdMode: "worktree" });
  api.threadStart.mockResolvedValueOnce({...created,thread:{...created.thread,cwd:"/worktree"}});
  const shouldActivate = vi.fn(() => false);
  expect(await codexService.threadStart({ shouldActivate })).toEqual(
    {...created.thread,cwd:"/worktree"},
  );
  expect(api.threadStart.mock.calls[0][0].cwd).toBe("/worktree");
  expect(api.gitCreateWorktree.mock.calls[0][2].signal.aborted).toBe(false);
  expect(api.threadStart.mock.calls[0][1].signal.aborted).toBe(false);
  expect(shouldActivate).toHaveBeenCalledTimes(1);
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
  expect(useThreadModelStore.getState().threads.created.model).toBe(
    "native-model",
  );
});

it("activates a successful new thread and returns a confirmed goal response", async () => {
  await codexService.threadStart();
  expect(useCodexStore.getState().currentThreadId).toBe("created");
  const response = {
    goal: {
      threadId: "created",
      objective: "next",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  };
  api.threadGoalSet.mockResolvedValue(response);
  expect(
    await codexService.threadGoalSet({
      threadId: "created",
      objective: "next",
    }),
  ).toBe(response);
  expect(api.threadGoalSet.mock.calls[0][1].signal.aborted).toBe(false);
});

it("preserves explicit errors without converting them into an unconfirmed result", async () => {
  const error = new Error("permission denied");
  api.threadStart.mockRejectedValue(error);
  api.threadGoalSet.mockRejectedValue(error);
  await expect(codexService.threadStart()).rejects.toBe(error);
  await expect(
    codexService.threadGoalSet({ threadId: "selected", objective: "next" }),
  ).rejects.toBe(error);
});

it("never continues a worktree creation on another runtime after the connection changes", async () => {
  useConfigStore.setState({ threadCwdMode: "worktree" });
  const worktree = deferred<{ worktree_path: string }>();
  api.gitCreateWorktree.mockReturnValue(worktree.promise);
  const pending = codexService.threadStart();
  await vi.waitFor(()=>expect(api.gitCreateWorktree).toHaveBeenCalledOnce());
  resetCodexRuntimeState();
  worktree.resolve({ worktree_path: "/previous-runtime-worktree" });
  await expect(pending).rejects.toThrow(/连接.*切换.*结果未确认/);
  expect(api.threadStart).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
});

it("never applies thread creation settings or activation after the connection changes", async () => {
  const creation = deferred<typeof created>();
  api.threadStart.mockReturnValue(creation.promise);
  const shouldActivate = vi.fn(() => true);
  const pending = codexService.threadStart({ shouldActivate });
  await vi.waitFor(()=>expect(api.threadStart).toHaveBeenCalledOnce());
  resetCodexRuntimeState();
  creation.resolve(created);
  await expect(pending).rejects.toThrow(/连接.*切换.*结果未确认/);
  expect(shouldActivate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
  expect(useCodexStore.getState().threads).toEqual([]);
  expect(useThreadModelStore.getState().threads).toEqual({});
});

it("does not confirm a goal response belonging to the previous runtime", async () => {
  const goal = deferred<{ goal: { objective: string } }>();
  api.threadGoalSet.mockReturnValue(goal.promise);
  const pending = codexService.threadGoalSet({
    threadId: "selected",
    objective: "next",
  });
  resetCodexRuntimeState();
  goal.resolve({ goal: { objective: "next" } });
  await expect(pending).rejects.toThrow(/连接.*切换.*结果未确认/);
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
});
