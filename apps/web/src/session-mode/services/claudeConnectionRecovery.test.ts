import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ snapshot: vi.fn(), resume: vi.fn() }));
vi.mock("./apiAdapt/cc", () => ({
  ccReadSessionSnapshot: api.snapshot,
  ccResumeSession: api.resume,
}));
import {
  refreshClaudeConnection,
  ensureClaudeSessionForSend,
} from "./claudeConnectionRecovery";
import {
  useClaudeConnectionStore,
  claudeSessionMatchesEvent,
  noteClaudeEvent,
} from "./claudeConnectionIdentity";
import { useCCStore } from "../stores/cc";
import { SessionApiError } from "./apiAdapt/shared";
const snapshot = () => ({
  runtimeInstance: "runtime",
  sessionId: "thread",
  eventSessionId: "wrapper",
  nativeSessionId: "native",
  cwd: "/project",
  running: true,
  connected: true,
  optionsKnown: true,
  options: { model: "original" },
  permissions: [
    {
      requestId: "request",
      sessionId: "wrapper",
      toolName: "Bash",
      toolInput: {},
      alwaysAllowTarget: "session",
      toolInputTruncated: true,
      inputAvailable: true,
      inputRevision: "revision",
      executionId: "turn",
    },
  ],
  revision: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  api.snapshot.mockResolvedValue(snapshot());
  api.resume.mockResolvedValue(undefined);
  useClaudeConnectionStore.setState({ owners: {}, errors: {} });
  useCCStore.setState({
    activeSessionId: "thread",
    activeSessionIds: ["thread"],
    messages: [],
    sessionMessagesMap: { thread: [] },
    sessionLoadingMap: {},
    isLoading: false,
    isConnected: false,
  });
});
it("refresh restores the same running owner and pending permission without resume, including native aliases", async () => {
  await refreshClaudeConnection("thread", "/project");
  expect(api.resume).not.toHaveBeenCalled();
  expect(useCCStore.getState().isLoading).toBe(true);
  expect(useCCStore.getState().messages[0]).toMatchObject({
    requestId: "request",
    sessionId: "thread",
    recoveryRuntimeInstance: "runtime",
    toolInputTruncated: true,
  });
  expect(claudeSessionMatchesEvent("thread", "wrapper")).toBe(true);
  expect(claudeSessionMatchesEvent("thread", "native")).toBe(true);
  await ensureClaudeSessionForSend("thread", "/project", {
    cwd: "/project",
    model: "replacement",
  });
  expect(api.resume).not.toHaveBeenCalled();
});
it("unverified activeSessionIds do not skip a readonly owner check; only explicit missing-owner sends resume", async () => {
  api.snapshot
    .mockRejectedValueOnce(new SessionApiError("Client not found", 404))
    .mockResolvedValueOnce(snapshot());
  await ensureClaudeSessionForSend("thread", "/project", {
    cwd: "/project",
    model: "captured",
  });
  expect(api.resume).toHaveBeenCalledOnce();
  expect(api.resume).toHaveBeenCalledWith("thread", {
    cwd: "/project",
    model: "captured",
  });
  expect(api.snapshot).toHaveBeenCalledTimes(2);
});
it("unknown service/ownership failures never replace the existing owner", async () => {
  api.snapshot.mockRejectedValue(new SessionApiError("scope changed", 409));
  await expect(
    ensureClaudeSessionForSend("thread", "/project", { cwd: "/project" }),
  ).rejects.toThrow("scope changed");
  expect(api.resume).not.toHaveBeenCalled();
});
it("a late snapshot cannot resurrect pending permission or busy state after a newer terminal event", async () => {
  let release!: (value: unknown) => void;
  api.snapshot.mockImplementation(
    () => new Promise((resolve) => (release = resolve)),
  );
  const pending = refreshClaudeConnection("thread", "/project");
  noteClaudeEvent("thread");
  useCCStore.setState({
    sessionLoadingMap: { thread: false },
    isLoading: false,
  });
  release(snapshot());
  await pending;
  expect(useCCStore.getState().messages).toEqual([]);
  expect(useCCStore.getState().isLoading).toBe(false);
});
it("a successful owner snapshot clears obsolete pending permission without deleting replies", async () => {
  useCCStore.setState({
    sessionMessagesMap: {
      thread: [
        {
          type: "permission_request",
          requestId: "old",
          sessionId: "thread",
          toolName: "Bash",
          toolInput: {},
        },
        {
          type: "assistant",
          uuid: "answer",
          session_id: "thread",
          message: { content: [] },
        } as never,
      ],
    },
  });
  api.snapshot.mockResolvedValue({
    ...snapshot(),
    running: false,
    permissions: [],
  });
  await refreshClaudeConnection("thread", "/project");
  expect(useCCStore.getState().messages).toHaveLength(1);
  expect(useCCStore.getState().messages[0].type).toBe("assistant");
});
it("identical metadata snapshots retain existing rows and notify no subscribers", async () => {
  await refreshClaudeConnection("thread", "/project");
  const rows = useCCStore.getState().sessionMessagesMap.thread;
  const cc = vi.fn(),
    metadata = vi.fn(),
    stopCC = useCCStore.subscribe(cc),
    stopMetadata = useClaudeConnectionStore.subscribe(metadata);
  try {
    await refreshClaudeConnection("thread", "/project");
    expect(useCCStore.getState().sessionMessagesMap.thread).toBe(rows);
    expect(cc).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
  } finally {
    stopCC();
    stopMetadata();
  }
});
