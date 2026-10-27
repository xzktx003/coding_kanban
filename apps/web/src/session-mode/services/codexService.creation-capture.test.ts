import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  gitCreateWorktree: vi.fn(),
  threadGoalSet: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);

import { codexService, resetCodexRuntimeState } from "./codexService";
import { useCodexStore, useConfigStore } from "../components/codex/stores";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import {
  useThreadModelStore,
  flushThreadModelSettings,
} from "../stores/useThreadModelStore";
import { useSettingsStore } from "../stores/settings";

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
  // thread/start hydrates asynchronously into real IDB. Settle this case's
  // transactions before removing the fake timers that drive fake-indexeddb.
  const settingsSettled = Promise.all(
    Object.keys(useThreadModelStore.getState().threads).map((id) =>
      flushThreadModelSettings(id),
    ),
  );
  await vi.runOnlyPendingTimersAsync();
  await settingsSettled;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

for (const mode of ["local", "worktree"] as const) {
  it(`rejects a captured ${mode} creation after runtime change before any outbound request`, async () => {
    useConfigStore.setState({ threadCwdMode: mode });
    const captured = codexService.captureThreadStart();
    resetCodexRuntimeState();
    await expect(codexService.threadStart({ captured })).rejects.toThrow(
      "连接目标已切换",
    );
    expect(api.gitCreateWorktree).not.toHaveBeenCalled();
    expect(api.threadStart).not.toHaveBeenCalled();
  });
}
it("uses the complete captured creation config and workspace without activating a newly selected target", async () => {
  useConfigStore.setState({
    model: "captured-model",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    reasoningEffort: "high",
    threadCwdMode: "worktree",
    webSearchRequest: true,
    serviceTier: "fast",
  });
  useSettingsStore.setState({ agentsMaxThreads: 4, agentsMaxDepth: 2 });
  const captured = codexService.captureThreadStart();
  useSettingsStore.setState({ agentsMaxThreads: 8, agentsMaxDepth: 3 });
  useWorkspaceStore.setState({ cwd: "/another-project" });
  useConfigStore.setState({
    model: "another-model",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    reasoningEffort: "low",
    threadCwdMode: "local",
    webSearchRequest: false,
    serviceTier: null,
  });
  await codexService.threadStart({ captured, shouldActivate: () => false });
  expect(api.gitCreateWorktree.mock.calls[0][0]).toBe("/project");
  expect(api.threadStart.mock.calls[0][0]).toMatchObject({
    model: "captured-model",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    serviceTier: "fast",
    cwd: "/worktree",
    config: {
      model_reasoning_effort: "high",
      web_search_request: true,
      "agents.max_threads": 4,
      "agents.max_depth": 2,
    },
  });
  expect(useCodexStore.getState().currentThreadId).toBe("selected");
});

it("captures an object approval policy by value before the original settings object changes", async () => {
  const policy = {
    granular: {
      sandbox_approval: true,
      rules: true,
      skill_approval: true,
      request_permissions: true,
      mcp_elicitations: true,
    },
  };
  useConfigStore.setState({ approvalPolicy: policy });
  const captured = codexService.captureThreadStart();
  policy.granular.rules = false;
  await codexService.threadStart({ captured });
  expect(api.threadStart.mock.calls[0][0].approvalPolicy.granular.rules).toBe(
    true,
  );
  expect(captured.config.approvalPolicy).not.toBe(policy);
});
