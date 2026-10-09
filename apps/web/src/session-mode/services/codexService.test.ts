import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  gitCreateWorktree: vi.fn(),
  threadRead: vi.fn(),
  threadRollback: vi.fn(),
  turnInterrupt: vi.fn(),
  turnStart: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
import { codexService } from "./codexService";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { useConfigStore } from "../components/codex/stores/useConfigStore";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useAsyncQuestionStore } from "../features/async-questions/store";
import {
  hydrateThreadModel,
  useThreadModelStore,
} from "../stores/useThreadModelStore";
beforeEach(() => {
  vi.clearAllMocks();
  useThreadModelStore.setState({ threads: {} });
  useWorkspaceStore.setState({ cwd: "/project" });
  useConfigStore.setState({ threadCwdMode: "worktree", model: "" });
});
it("a background check keeps existing content interactive without the initial history loader", async () => {
  let resolve!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useCodexStore.setState({
    historyLoadedMap: { cached: true },
    events: { cached: [] },
    historyLoadingMap: {},
    threads: [],
    currentThreadId: "cached",
  });
  const pending = codexService.loadThreadHistory("cached", undefined, {
    background: true,
  });
  expect(useCodexStore.getState().historyLoadingMap.cached).not.toBe(true);
  expect(useSessionSyncStore.getState().checking.cached).toBe(true);
  resolve({ thread: { id: "cached", turns: [] } });
  await pending;
  expect(useSessionSyncStore.getState().checking.cached).toBeUndefined();
});
it("warm history reveals a newly discovered active question once, while cold hydration remains passive", async () => {
  const id = "warm-question";
  const question = {
    type: "agentMessage",
    id: "missed-question",
    text: "选择环境",
    questions: [{ title: "选择环境", options: ["隔离", "真实"] }],
  };
  const thread = {
    id,
    turns: [
      {
        id: "warm-turn",
        status: "inProgress",
        startedAt: 1,
        durationMs: null,
        items: [question],
      },
    ],
  };
  useAsyncQuestionStore.setState({ sessions: {} });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useCodexStore.setState({
    currentThreadId: id,
    currentTurnId: null,
    events: {},
    turnTimingMap: {},
    historyLoadedMap: {},
    threads: [],
    threadStatusMap: {},
  });
  api.threadRead.mockResolvedValue({ thread });
  await codexService.loadThreadHistory(id, undefined, {
    background: true,
    recent: true,
  });
  expect(useAsyncQuestionStore.getState().sessions[id]?.openId).toBeUndefined();
  useCodexStore.setState({ events: { [id]: [] } });
  await codexService.loadThreadHistory(id, undefined, { background: true });
  expect(useAsyncQuestionStore.getState().sessions[id]?.openId).toBeUndefined();
  useCodexStore.setState({ events: { [id]: [] } });
  await codexService.loadThreadHistory(id, undefined, {
    background: true,
    recent: true,
  });
  expect(useAsyncQuestionStore.getState().sessions[id]?.openId).toBeTruthy();
  useAsyncQuestionStore.getState().patch(id, { openId: undefined });
  await codexService.loadThreadHistory(id, undefined, {
    background: true,
    recent: true,
  });
  expect(useAsyncQuestionStore.getState().sessions[id]?.openId).toBeUndefined();
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
  hydrateThreadModel("mode", {
    model: "test-model",
    modelProvider: "openai",
    reasoningEffort: "medium",
  });
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
it("enables questions for new threads and reads existing history without applying execution config", async () => {
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
  api.threadRead.mockResolvedValueOnce({
    thread: { id: "questions-old", turns: [] },
  });
  await codexService.threadResume("questions-old", {
    config: { "features.example": true },
  });
  expect(api.threadRead.mock.calls.at(-1)?.[0]).toEqual({
    threadId: "questions-old",
  });
});
it("routes workspace-write approval requests to native auto review while preserving sandbox policy", async () => {
  useConfigStore.setState({
    threadCwdMode: "local",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  });
  api.threadStart.mockResolvedValueOnce({
    thread: { id: "auto-review", preview: "", turns: [] },
    model: "test-model",
  });
  await codexService.threadStart();
  expect(api.threadStart.mock.calls.at(-1)?.[0]).toMatchObject({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });

  api.turnStart.mockResolvedValueOnce({
    turn: { id: "turn", status: "inProgress", items: [] },
  });
  await codexService.turnStart("auto-review", "continue");
  expect(api.turnStart.mock.calls.at(-1)?.[0]).toMatchObject({
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxPolicy: { type: "workspaceWrite" },
  });
});
it("keeps explicit user review for read-only and danger-full-access modes", async () => {
  useConfigStore.setState({
    threadCwdMode: "local",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
  api.threadStart.mockResolvedValueOnce({ thread: { id: "read", turns: [] } });
  await codexService.threadStart();
  expect(api.threadStart.mock.calls.at(-1)?.[0].approvalsReviewer).toBe("user");

  useConfigStore.setState({
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
  api.threadStart.mockResolvedValueOnce({ thread: { id: "full", turns: [] } });
  await codexService.threadStart();
  expect(api.threadStart.mock.calls.at(-1)?.[0].approvalsReviewer).toBe("user");
});
it("does not silently run in the shared project if preparing an isolated worktree fails", async () => {
  api.gitCreateWorktree.mockRejectedValue(new Error("worktree failed"));
  await expect(codexService.threadStart()).rejects.toThrow("worktree failed");
  expect(api.threadStart).not.toHaveBeenCalled();
});

it("a late resume caches its history without stealing focus from a newer selection", async () => {
  let resolve!: (value: unknown) => void;
  api.threadRead.mockImplementation(
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
  api.threadRead.mockImplementation(
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
  expect(api.threadRead).toHaveBeenCalledTimes(1);
  resolve({ thread: { id: "shared", turns: [] } });
  await Promise.all([first, second]);
});
it("shows loading and a retryable history error, then clears it after success", async () => {
  api.threadRead.mockRejectedValueOnce(new Error("history unavailable"));
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
  api.threadRead.mockResolvedValueOnce({
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
  api.threadRead.mockImplementation(
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
  api.threadRead.mockResolvedValueOnce({
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
  api.threadRead.mockResolvedValueOnce({
    thread: { id: "partial", turns: [] },
  });
  await codexService.setCurrentThread("partial");
  expect(api.threadRead).toHaveBeenCalledOnce();
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
  api.threadRead.mockResolvedValueOnce({
    thread: { id: "visible", turns: [] },
  });
  await codexService.threadResume("visible", undefined, { background: true });
  expect(useCodexStore.getState().currentThreadId).toBe("visible");
  expect(useCodexStore.getState().inputFocusTrigger).toBe(42);
  expect(useCodexStore.getState().historyLoadedMap.visible).toBe(true);
});

it("a same-turn history reconciliation preserves the observed start time when native metadata omits it", async () => {
  useCodexStore.setState({
    currentThreadId: "sparse",
    events: {},
    threads: [],
    threadStatusMap: {},
    turnTimingMap: {
      sparse: {
        turnId: "same",
        status: "inProgress",
        startedAtMs: 123000,
        durationMs: null,
      },
    },
  });
  api.threadRead.mockResolvedValue({
    thread: {
      id: "sparse",
      status: { type: "idle" },
      turns: [
        {
          id: "same",
          status: "completed",
          startedAt: null,
          durationMs: 2000,
          items: [],
          error: null,
        },
      ],
    },
  });
  await codexService.loadThreadHistory("sparse", undefined, {
    background: true,
  });
  expect(useCodexStore.getState().turnTimingMap.sparse).toMatchObject({
    status: "completed",
    startedAtMs: 123000,
    durationMs: 2000,
  });
});

it("cached read-only selection resolves before native verification without taking writer ownership", async () => {
  let resolve!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  useCodexStore.setState({
    currentThreadId: null,
    currentTurnId: null,
    activeThreadIds: [],
    events: { "passive-cache": [] },
    threads: [],
    historyLoadedMap: { "passive-cache": true },
    historyLoadingMap: {},
    turnTimingMap: {},
  });
  let selected = false;
  const selection = codexService.setCurrentThread("passive-cache").then(() => {
    selected = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  const resolvedWithoutNetwork = selected;
  resolve({ thread: { id: "passive-cache", turns: [] } });
  await selection;
  expect(resolvedWithoutNetwork).toBe(true);
  expect(useCodexStore.getState().activeThreadIds).toEqual([]);
  expect(api.threadRead).toHaveBeenCalledExactlyOnceWith(
    { threadId: "passive-cache", recent: true },
    expect.objectContaining({ suppressToast: true }),
  );
  await codexService.loadThreadHistory("passive-cache", undefined, {
    recent: true,
    background: true,
  });
});
