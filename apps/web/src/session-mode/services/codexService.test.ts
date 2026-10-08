import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  gitCreateWorktree: vi.fn(),
  threadResume: vi.fn(),
  threadRollback: vi.fn(),
  turnInterrupt: vi.fn(),
  turnStart: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
import { codexService } from "./codexService";
import { useConfigStore } from "../components/codex/stores/useConfigStore";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { hydrateThreadModel, useThreadModelStore } from "../stores/useThreadModelStore";
beforeEach(() => {
  vi.clearAllMocks();
  useThreadModelStore.setState({ threads: {} });
  useWorkspaceStore.setState({ cwd: "/project" });
  useConfigStore.setState({ threadCwdMode: "worktree", model: "" });
});
it("sends the selected collaboration mode on each actual turn, including an existing thread", async () => {
  api.turnStart.mockResolvedValue({
    turn: { id: "mode-turn", status: "inProgress", items: [] },
  });
  useCodexStore.setState({
    currentThreadId: "mode",
    threads: [],
    turnTimingMap: {},
  });
  useConfigStore.setState({
    model: "test-model",
    reasoningEffort: "medium",
    collaborationMode: "plan",
  });
  hydrateThreadModel("mode", { model: "test-model", modelProvider: "openai", reasoningEffort: "medium" });
  await codexService.turnStart("mode", "Ask me a choice");
  expect(api.turnStart.mock.calls.at(-1)?.[0].collaborationMode).toEqual({
    mode: "plan",
    settings: {
      model: "test-model",
      reasoning_effort: "medium",
      developer_instructions: null,
    },
  });
  useConfigStore.setState({ collaborationMode: "default" });
  await codexService.turnStart("mode", "Continue");
  expect(api.turnStart.mock.calls.at(-1)?.[0].collaborationMode.mode).toBe(
    "default",
  );
});
it("enables native questions for new and resumed Session threads without rewriting global CLI config", async () => {
  useConfigStore.setState({ threadCwdMode: "local" });
  api.threadStart.mockResolvedValueOnce({
    thread: { id: "questions", turns: [] },
    model: "test-model",
  });
  await codexService.threadStart();
  expect(
    api.threadStart.mock.calls.at(-1)?.[0].config[
      "features.default_mode_request_user_input"
    ],
  ).toBe(true);
  api.threadResume.mockResolvedValueOnce({
    thread: { id: "questions-old", turns: [] },
  });
  await codexService.threadResume("questions-old", {
    config: { "features.example": true },
  });
  expect(api.threadResume.mock.calls.at(-1)?.[0].config).toEqual({
    "features.default_mode_request_user_input": true,
    "features.example": true,
  });
});
it("does not silently run in the shared project if preparing an isolated worktree fails", async () => {
  api.gitCreateWorktree.mockRejectedValue(new Error("worktree failed"));
  await expect(codexService.threadStart()).rejects.toThrow("worktree failed");
  expect(api.threadStart).not.toHaveBeenCalled();
});

it("a late resume caches its history without stealing focus from a newer selection", async () => {
  let resolve!: (value: unknown) => void;
  api.threadResume.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: null,
    activeThreadIds: [],
    events: {},
    threads: [],
  });
  const pending = codexService.setCurrentThread("older");
  useCodexStore.setState({ currentThreadId: "newer", inputFocusTrigger: 10 });
  resolve({ thread: { id: "older", turns: [] } });
  await pending;
  expect(useCodexStore.getState().currentThreadId).toBe("newer");
  expect(useCodexStore.getState().inputFocusTrigger).toBe(10);
  expect(useCodexStore.getState().events.older).toEqual([]);
});
it("concurrent selections coalesce a pending resume", async () => {
  let resolve!: (value: unknown) => void;
  api.threadResume.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: null,
    activeThreadIds: [],
    events: {},
    threads: [],
  });
  const first = codexService.setCurrentThread("shared");
  const second = codexService.setCurrentThread("shared");
  expect(api.threadResume).toHaveBeenCalledTimes(1);
  resolve({ thread: { id: "shared", turns: [] } });
  await Promise.all([first, second]);
});
it("shows loading and a retryable history error, then clears it after success", async () => {
  api.threadResume.mockRejectedValueOnce(new Error("history unavailable"));
  useCodexStore.setState({
    currentThreadId: "failed",
    activeThreadIds: [],
    events: {},
    threads: [],
  });
  await expect(codexService.threadResume("failed")).rejects.toThrow(
    "history unavailable",
  );
  expect(useCodexStore.getState().historyLoadingMap.failed).toBe(false);
  expect(useCodexStore.getState().historyErrorMap.failed).toBe(
    "history unavailable",
  );
  api.threadResume.mockResolvedValueOnce({
    thread: { id: "failed", turns: [] },
  });
  await codexService.threadResume("failed");
  expect(useCodexStore.getState().historyErrorMap.failed).toBeUndefined();
});

it("rollback sends its exact turn boundary and a late result cannot change another active conversation", async () => {
  let resolve!: (value: unknown) => void;
  api.threadRollback.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: "edited",
    currentTurnId: null,
    activeThreadIds: ["edited"],
    events: { edited: [] },
    threads: [],
    threadStatusMap: {},
    turnTimingMap: {},
  });
  const pending = codexService.threadRollback("edited", 2, "cut-turn");
  useCodexStore.setState({
    currentThreadId: "other",
    currentTurnId: "other-turn",
    inputFocusTrigger: 20,
  });
  resolve({ thread: { id: "edited", turns: [] } });
  await pending;
  expect(api.threadRollback).toHaveBeenCalledWith({
    threadId: "edited",
    numTurns: 2,
    beforeTurnId: "cut-turn",
  });
  expect(useCodexStore.getState().currentThreadId).toBe("other");
  expect(useCodexStore.getState().currentTurnId).toBe("other-turn");
  expect(useCodexStore.getState().inputFocusTrigger).toBe(20);
});
it("refuses to rollback a running conversation and coalesces a repeated rollback", async () => {
  useCodexStore.setState({
    currentThreadId: "busy",
    threadStatusMap: { busy: { type: "active", activeFlags: [] } },
    turnTimingMap: {},
  });
  await expect(codexService.threadRollback("busy", 1, "cut")).rejects.toThrow();
  expect(api.threadRollback).not.toHaveBeenCalled();
  useCodexStore.setState({
    currentThreadId: "idle",
    threadStatusMap: {},
    currentTurnId: null,
  });
  let resolve!: (value: unknown) => void;
  api.threadRollback.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const first = codexService.threadRollback("idle", 1, "cut");
  const second = codexService.threadRollback("idle", 1, "cut");
  expect(api.threadRollback).toHaveBeenCalledTimes(1);
  resolve({ thread: { id: "idle", turns: [] } });
  await Promise.all([first, second]);
});

it("an old pending resume cannot restore turns removed by rollback", async () => {
  let resolveResume!: (value: unknown) => void;
  api.threadResume.mockImplementation(
    () =>
      new Promise((r) => {
        resolveResume = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: "race",
    currentTurnId: null,
    threadStatusMap: {},
    turnTimingMap: {},
    activeThreadIds: [],
    events: {},
    threads: [],
  });
  const resume = codexService.threadResume("race");
  api.threadRollback.mockResolvedValue({ thread: { id: "race", turns: [] } });
  await codexService.threadRollback("race", 1, "cut");
  resolveResume({
    thread: {
      id: "race",
      turns: [{ id: "discarded", items: [], status: "completed" }],
    },
  });
  await resume;
  expect(useCodexStore.getState().events.race).toEqual([]);
  expect(useCodexStore.getState().historyLoadingMap.race).toBe(false);
});

it("resume restores the active turn and thread status for stop controls", async () => {
  useCodexStore.setState({
    currentThreadId: "restored",
    currentTurnId: null,
    threadStatusMap: {},
    turnTimingMap: {},
    events: {},
    threads: [],
  });
  api.threadResume.mockResolvedValueOnce({
    thread: {
      id: "restored",
      status: { type: "active", activeFlags: [] },
      turns: [
        {
          id: "live",
          items: [],
          status: "inProgress",
          startedAt: 1,
          durationMs: null,
        },
      ],
    },
  });
  await codexService.threadResume("restored");
  expect(useCodexStore.getState().currentTurnId).toBe("live");
  expect(useCodexStore.getState().turnTimingMap.restored.status).toBe(
    "inProgress",
  );
  expect(useCodexStore.getState().threadStatusMap.restored.type).toBe("active");
});
it("a late stop response cannot clear another session or a newer turn", async () => {
  let resolve!: () => void;
  api.turnInterrupt.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: "a",
    currentTurnId: "old",
    turnTimingMap: {
      a: {
        turnId: "old",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  const pending = codexService.turnInterrupt("a", "old");
  useCodexStore.setState({ currentThreadId: "b", currentTurnId: "new" });
  resolve();
  await pending;
  expect(useCodexStore.getState().currentTurnId).toBe("new");
});

it("a delayed start response cannot revive a turn already completed by streaming", async () => {
  let resolve!: (value: unknown) => void;
  api.turnStart.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    currentThreadId: "a",
    currentTurnId: null,
    turnTimingMap: {},
    threads: [],
  });
  const pending = codexService.turnStart("a", "hello");
  useCodexStore.setState({
    turnTimingMap: {
      a: {
        turnId: "quick",
        status: "completed",
        startedAtMs: 1,
        durationMs: 2,
      },
    },
  });
  resolve({
    turn: { id: "quick", status: "inProgress", startedAt: 1, durationMs: null },
  });
  await pending;
  expect(useCodexStore.getState().turnTimingMap.a.status).toBe("completed");
  expect(useCodexStore.getState().currentTurnId).toBeNull();
});
it("a stop failure preserves the current task for retry", async () => {
  useCodexStore.setState({ currentThreadId: "a", currentTurnId: "retry" });
  api.turnInterrupt.mockRejectedValueOnce(new Error("offline"));
  await expect(codexService.turnInterrupt("a", "retry")).rejects.toThrow(
    "offline",
  );
  expect(useCodexStore.getState().currentTurnId).toBe("retry");
});
it("a late stop response cannot clear a newer turn in the same session", async () => {
  let resolve!: () => void;
  api.turnInterrupt.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({ currentThreadId: "a", currentTurnId: "old" });
  const pending = codexService.turnInterrupt("a", "old");
  useCodexStore.setState({ currentTurnId: "new" });
  resolve();
  await pending;
  expect(useCodexStore.getState().currentTurnId).toBe("new");
});

it("does not mistake streamed events for fully hydrated history", async () => {
  useCodexStore.setState({
    currentThreadId: null,
    activeThreadIds: ["partial"],
    historyLoadedMap: {},
    events: { partial: [] },
    threads: [],
  });
  api.threadResume.mockResolvedValueOnce({
    thread: { id: "partial", turns: [] },
  });
  await codexService.setCurrentThread("partial");
  expect(api.threadResume).toHaveBeenCalledOnce();
  expect(useCodexStore.getState().historyLoadedMap.partial).toBe(true);
});
it("background history refresh preserves input focus, selection and fills the hydration marker", async () => {
  useCodexStore.setState({
    currentThreadId: "visible",
    inputFocusTrigger: 42,
    historyLoadedMap: {},
    events: {},
    threads: [],
  });
  api.threadResume.mockResolvedValueOnce({
    thread: { id: "visible", turns: [] },
  });
  await codexService.threadResume("visible", undefined, { background: true });
  expect(useCodexStore.getState().currentThreadId).toBe("visible");
  expect(useCodexStore.getState().inputFocusTrigger).toBe(42);
  expect(useCodexStore.getState().historyLoadedMap.visible).toBe(true);
});
