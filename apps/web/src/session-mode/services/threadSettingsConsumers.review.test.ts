vi.mock("./nativeOperationContext",()=>({readNativeOperationContext:async()=>({namespace:"private-fixture-native-domain",scopeToken:"a".repeat(64)})}));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn(),
  scope: vi.fn(),
  hydrate: vi.fn(),
  getSettings: vi.fn(),
}));
const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  threadFork: vi.fn(),
  threadRead: vi.fn(),
  threadMetadata: vi.fn(),
  threadGoalGet: vi.fn(),
  turnStart: vi.fn(),
  postJsonWithOptions: vi.fn(),
}));
vi.mock("../stores/useThreadModelStore", async (original) => ({
  ...(await original<object>()),
  getThreadModelSettings: boundary.getSettings,
  captureThreadModelSelection: boundary.capture,
  flushThreadModelSettings: boundary.flush,
  setThreadModelRuntimeScope: boundary.scope,
  hydrateThreadModel: boundary.hydrate,
  assertThreadModelSelectionCurrent: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
vi.mock("./apiAdapt/shared", async (original) => ({
  ...(await original<object>()),
  postJsonWithOptions: api.postJsonWithOptions,
}));
vi.mock("./apiAdapt/codex", () => ({
  ...api,
  threadAccess: vi.fn(async () => ({ state: "owned", generation: 1 })),
  threadFork: api.threadFork,
  threadMetadata: api.threadMetadata,
}));
import { codexService, resetCodexRuntimeState } from "./codexService";
import { followupService, useFollowupStore } from "./followupService";
import { useCodexStore, useConfigStore } from "../components/codex/stores";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import { createSideChat } from "./conversationActions";
import { resetGoalCompletionScope } from "./goalCompletionAutoClear";
import { MutationNotStartedError } from "./MutationNotStartedError";
import { resetCodexAccessCache } from "../stores/useCodexAccessStore";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settings = {
  model: "captured-model",
  modelProvider: "openai",
  reasoningEffort: "high",
  serviceTier: null,
  sandbox: "read-only",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  webSearchRequest: false,
  collaborationMode: "default",
  providerModels: {},
  personality: null,
};
const thread = (id: string) => ({
  id,
  cwd: "/fixture-original",
  preview: "",
  turns: [],
  status: { type: "idle" },
  createdAt: 1,
  updatedAt: 1,
});
beforeEach(() => {
  for (let i=localStorage.length-1;i>=0;i--) { const key=localStorage.key(i); if(key?.startsWith("kanban.session.execution")) localStorage.removeItem(key); }
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  localStorage.clear();
  resetCodexRuntimeState();
  resetCodexAccessCache();
  useFollowupStore.setState({ threads: {}, errors: {} });
  useCodexDeliveryStore.setState({ entries: {} });
  useCodexStore.setState({
    currentThreadId: "original",
    currentTurnId: null,
    threads: [thread("original") as any],
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
    activeThreadIds: [],
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    accountNamespace: "account-before",
  });
  useWorkspaceStore.setState({ cwd: "/fixture-original" });
  useConfigStore.setState({ ...settings, threadCwdMode: "local" } as any);
  api.threadGoalGet.mockResolvedValue({ goal: null });
  boundary.getSettings.mockReturnValue({ ...settings, model: null });
  boundary.capture.mockReturnValue({
    threadId: "original",
    token: { edit: "captured" },
    settings: structuredClone(settings),
  });
  boundary.flush.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
it("ignores a fork acknowledgement from a runtime that changed after the request", async () => {
  const gate = deferred<any>();
  api.threadFork.mockReturnValue(gate.promise);
  const pending = codexService.threadFork("original");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(api.threadFork).toHaveBeenCalledOnce());
  resetCodexRuntimeState();
  boundary.hydrate.mockClear();
  gate.resolve({
    thread: thread("old-runtime-child"),
    model: "old-runtime-model",
  });
  await expect(pending).rejects.toThrow();
  expect(boundary.hydrate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("original");
});
it("does not hydrate or activate thread creation received after account scope changes", async () => {
  const gate = deferred<any>();
  api.threadStart.mockReturnValue(gate.promise);
  const pending = codexService.threadStart();
  void pending.catch(() => {});
  await vi.waitFor(() => expect(api.threadStart).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "account-after" });
  boundary.hydrate.mockClear();
  gate.resolve({
    thread: thread("old-account-created"),
    model: "old-account-model",
  });
  await expect(pending).rejects.toThrow();
  expect(boundary.hydrate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("original");
});
it("does not apply a native turn acknowledgement after account scope changes", async () => {
  const gate = deferred<any>();
  api.turnStart.mockReturnValue(gate.promise);
  const pending = codexService.turnStart("original", "frozen draft");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(api.turnStart).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "account-after" });
  gate.resolve({
    turn: { id: "old-account-turn", status: "inProgress", startedAt: 1 },
  });
  await expect(pending).rejects.toThrow();
  expect(useCodexStore.getState().turnTimingMap.original).toBeUndefined();
});
it("does not publish an old account followup receipt into current queue state", async () => {
  const gate = deferred<any>();
  api.postJsonWithOptions.mockReturnValue(gate.promise);
  const pending = followupService.submit(
    "codex:original",
    { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000001" },
    "original",
    "draft",
    [],
    "queue",
  );
  void pending.catch(() => {});
  await vi.waitFor(() =>
    expect(api.postJsonWithOptions).toHaveBeenCalledOnce(),
  );
  useCodexStore.setState({ accountNamespace: "account-after" });
  gate.resolve({
    revision: 1,
    paused: null,
    items: [{ ...api.postJsonWithOptions.mock.calls[0][1], status: "queued" }],
  });
  await expect(pending).rejects.toThrow();
  expect(useFollowupStore.getState().threads.original).toBeUndefined();
});
it("frozen explicit rollback configuration bypasses unrelated storage failure and remains exact", async () => {
  boundary.flush.mockRejectedValue(
    new Error("quota unrelated to saved rollback"),
  );
  api.turnStart.mockResolvedValue({
    turn: { id: "frozen-rollback", status: "completed" },
  });
  const frozen = {
    cwd: "/original",
    model: "rollback-model",
    effort: "low",
    serviceTier: null,
    approvalPolicy: {
      reject: { sandbox_approval: true, rules: true, mcp_elicitations: true },
    },
    approvalsReviewer: "user",
    sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
    collaborationMode: {
      mode: "default",
      settings: {
        model: "rollback-model",
        reasoning_effort: "low",
        developer_instructions: null,
      },
    },
  };
  await codexService.turnStart(
    "original",
    "replacement",
    [],
    "frozen-id",
    undefined,
    frozen as any,
  );
  expect(boundary.capture).not.toHaveBeenCalled();
  expect(boundary.flush).not.toHaveBeenCalled();
  expect(api.turnStart.mock.calls[0][0]).toMatchObject(frozen);
});

it("rejects a captured new-chat request after account change before any write", async () => {
  const captured = codexService.captureThreadStart();
  useCodexStore.setState({ accountNamespace: "other-account" });
  await expect(codexService.threadStart({ captured })).rejects.toThrow();
  expect(api.threadStart).not.toHaveBeenCalled();
});
it("a same-valued account notification during settings flush rejects before turn write", async () => {
  const gate = deferred<void>();
  boundary.flush.mockReturnValue(gate.promise);
  const pending = codexService.turnStart("original", "captured");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(boundary.flush).toHaveBeenCalledOnce());
  resetGoalCompletionScope();
  gate.resolve();
  await expect(pending).rejects.toBeInstanceOf(MutationNotStartedError);
  expect(api.turnStart).not.toHaveBeenCalled();
});
it("account ABA cannot accept an old turn reply as a current write receipt", async () => {
  const gate = deferred<any>();
  api.turnStart.mockReturnValue(gate.promise);
  const pending = codexService.turnStart("original", "captured");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(api.turnStart).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "middle-account" });
  useCodexStore.setState({ accountNamespace: "account-before" });
  gate.resolve({
    turn: { id: "old-aba-turn", status: "inProgress", startedAt: 1 },
  });
  await expect(pending).rejects.toThrow();
  expect(useCodexStore.getState().turnTimingMap.original).toBeUndefined();
});
it("an old side-chat reply cannot seed settings or remove a newer scope's pending fork", async () => {
  const old = deferred<any>(),
    current = deferred<any>();
  api.threadFork
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = createSideChat("original");
  void first.catch(() => {});
  useCodexStore.setState({ accountNamespace: "account-after" });
  const second = createSideChat("original");
  void second.catch(() => {});
  expect(createSideChat("original")).toBe(second);
  old.resolve({ thread: thread("stale-side-chat") });
  await expect(first).rejects.toThrow();
  expect(boundary.hydrate).not.toHaveBeenCalled();
  expect(createSideChat("original")).toBe(second);
  current.resolve({
    thread: thread("current-side-chat"),
    model: "native-current",
  });
  await expect(second).resolves.toBe("current-side-chat");
  expect(api.threadFork).toHaveBeenCalledTimes(2);
  expect(boundary.hydrate.mock.calls.map((call) => call[0])).toEqual([
    "current-side-chat",
  ]);
});

it("a late history response from the previous account cannot populate metadata or transcript", async () => {
  const gate = deferred<any>();
  api.threadRead.mockReturnValue(gate.promise);
  const pending = codexService.loadThreadHistory("original", undefined, {
    background: true,
  });
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "account-history-after" });
  boundary.hydrate.mockClear();
  gate.resolve({
    thread: {
      ...thread("original"),
      cwd: "/stale-account",
      preview: "stale history",
      turns: [
        {
          id: "stale-turn",
          status: "completed",
          items: [
            { type: "agentMessage", id: "stale-item", text: "stale body" },
          ],
        },
      ],
    },
  });
  await expect(pending).resolves.toBeUndefined();
  expect(boundary.hydrate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().threads[0].cwd).toBe("/fixture-original");
  expect(useCodexStore.getState().events.original).toBeUndefined();
});
it("a new account history request does not coalesce into the stale account read or lose loading to its finally", async () => {
  const old = deferred<any>(),
    current = deferred<any>();
  api.threadRead
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = codexService.loadThreadHistory("original", undefined, {
    background: true,
  });
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "account-history-after" });
  const second = codexService.loadThreadHistory("original", undefined, {
    background: true,
  });
  old.resolve({ thread: { ...thread("original"), preview: "stale history" } });
  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledTimes(2));
  expect(useCodexStore.getState().historyLoadingMap.original).toBe(true);
  current.resolve({
    thread: { ...thread("original"), preview: "current history" },
  });
  await second;
  expect(useCodexStore.getState().threads[0].preview).toBe("current history");
  expect(useCodexStore.getState().historyLoadingMap.original).toBe(false);
});

it("the separate initial metadata read cannot merge an old account's cwd after a recent page", async () => {
  const metadata = deferred<any>();
  api.threadRead.mockResolvedValueOnce({
    thread: thread("original"),
    historyPage: { earlier: false, nextCursor: null },
  });
  api.threadMetadata.mockReturnValueOnce(metadata.promise);
  await codexService.loadThreadHistory("original", undefined, {
    background: true,
    recent: true,
  });
  await vi.waitFor(() =>
    expect(api.threadMetadata).toHaveBeenCalledWith(
      "original",
      expect.objectContaining({ signal: expect.any(AbortSignal), suppressToast: true }),
    ),
  );
  expect(api.threadRead).toHaveBeenCalledTimes(1);
  expect(api.threadRead.mock.calls[0][0]).toEqual({ threadId: "original", recent: true });
  useCodexStore.setState({ accountNamespace: "account-metadata-after" });
  boundary.hydrate.mockClear();
  metadata.resolve({
    thread: {
      ...thread("original"),
      cwd: "/old-metadata-cwd",
      preview: "old metadata",
    },
    model: "old-model",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(boundary.hydrate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().threads[0].cwd).toBe("/fixture-original");
});

it("a frozen override that omitted personality cannot inherit a later local personality", async () => {
  boundary.getSettings.mockReturnValue({
    ...settings,
    personality: "friendly",
  });
  api.turnStart.mockResolvedValue({
    turn: { id: "override-no-personality", status: "completed" },
  });
  await codexService.turnStart(
    "original",
    "replacement",
    [],
    "freeze-personality",
    undefined,
    {
      cwd: "/frozen",
      model: "frozen-model",
      effort: "low",
      serviceTier: null,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "dangerFullAccess" },
      collaborationMode: {
        mode: "default",
        settings: {
          model: "frozen-model",
          reasoning_effort: "low",
          developer_instructions: null,
        },
      },
    },
  );
  expect(api.turnStart.mock.calls[0][0]).not.toHaveProperty("personality");
});
vi.mock("./nativeOperationContext", () => ({ readNativeOperationContext: vi.fn(async () => ({ scopeToken: "fixture-runtime-scope", namespace: "fixture-history" })) }));
