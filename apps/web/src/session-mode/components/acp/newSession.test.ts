import { beforeEach, expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { buildUrl } from "@session/hooks/runtime";
import { useAcpRuntimeOwnersStore } from "@session/services/acpRuntimeOwners";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";
import { acpFreshSession } from "./newSession";
const api = vi.hoisted(() => ({
  cancel: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpCancel: api.cancel,
  acpNewSession: api.create,
  acpStart: api.start,
  acpStop: api.stop,
  acpReadConnectionSnapshot: vi.fn(),
}));
const started = () => ({
  connectionId: "connection-B",
  runtimeInstance: "runtime",
  sessionId: "s1",
  historySessionId: "source-B",
  session: { sessionId: "s1", historySessionId: "source-B" },
  initialize: {
    agentInfo: { title: "Agent B" },
    agentCapabilities: { loadSession: true },
  },
  sessionError: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  api.cancel.mockResolvedValue(undefined);
  api.stop.mockResolvedValue(undefined);
  api.create.mockResolvedValue({
    sessionId: "created",
    historySessionId: "source-created",
  });
  api.start.mockResolvedValue(started());
  useAcpStore.getState().reset();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    connectionId: "connection-A",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "s1",
    historySessionId: "source-A",
    sessionCwd: "/fixture",
    running: true,
    entries: [{ id: "context-A", role: "agent", text: "保留原任务" }],
  });
});
test("new chat creates an independent connection while the old task continues", async () => {
  expect(await acpFreshSession("connection-A", "/fixture")).toBe(true);
  expect(api.start).toHaveBeenCalledExactlyOnceWith("fixture", "/fixture");
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "connection-B",
    sessionId: "s1",
    historySessionId: "source-B",
    running: false,
  });
  expect(Object.values(useAcpRuntimeOwnersStore.getState().owners)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        connectionId: "connection-A",
        historySessionId: "source-A",
        running: true,
      }),
    ]),
  );
});
test("idle connection reuses session/new and preserves the original source pointer", async () => {
  useAcpStore.setState({ running: false });
  expect(await acpFreshSession("connection-A", "/fixture")).toBe(true);
  expect(api.create).toHaveBeenCalledExactlyOnceWith(
    "connection-A",
    "/fixture",
  );
  expect(api.start).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    sessionId: "created",
    historySessionId: "source-created",
    running: false,
  });
  expect(Object.values(useAcpRuntimeOwnersStore.getState().owners)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        connectionId: "connection-A",
        sessionId: "s1",
        historySessionId: "source-A",
      }),
    ]),
  );
});
test("a pending approval or unknown operation never uses session/new on that owner", async () => {
  useAcpStore.setState({
    running: false,
    sessionTransitionError: "delivery unknown",
  });
  expect(await acpFreshSession("connection-A", "/fixture")).toBe(true);
  expect(api.start).toHaveBeenCalledOnce();
  expect(api.create).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});
test("failed independent start preserves the original running target and body", async () => {
  api.start.mockRejectedValueOnce(new Error("start failed"));
  expect(await acpFreshSession("connection-A", "/fixture")).toBe(false);
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "connection-A",
    sessionId: "s1",
    running: true,
  });
  expect(useAcpStore.getState().entries[0]).toMatchObject({
    text: "保留原任务",
  });
  expect(api.cancel).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
});
test("a late new connection cannot replace another selection and only its own empty resource is closed", async () => {
  let resolve!: (value: ReturnType<typeof started>) => void;
  api.start.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const result = acpFreshSession("connection-A", "/fixture");
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  useAcpStore.setState({
    connectionId: "connection-C",
    sessionId: "session-C",
    historySessionId: "source-C",
  });
  resolve(started());
  expect(await result).toBe(false);
  expect(useAcpStore.getState().connectionId).toBe("connection-C");
  expect(api.stop).toHaveBeenCalledExactlyOnceWith("connection-B");
  expect(api.cancel).not.toHaveBeenCalled();
});
test("same-value account invalidation rejects a late result without adopting a new task", async () => {
  let resolve!: (value: ReturnType<typeof started>) => void;
  api.start.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const result = acpFreshSession("connection-A", "/fixture");
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  invalidateCodexOperationScope();
  resolve(started());
  expect(await result).toBe(false);
  expect(useAcpStore.getState().connectionId).toBe("connection-A");
  expect(api.stop).not.toHaveBeenCalled();
});
test("old connection calls cannot interrupt or replace the current owner", async () => {
  expect(await acpFreshSession("old", "/fixture")).toBe(false);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});
test("old runtimes without source identity cannot be adopted or silently restarted", async () => {
  useAcpStore.setState({ runtimeInstance: null });
  expect(await acpFreshSession("connection-A", "/fixture")).toBe(false);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(useAcpStore.getState().running).toBe(true);
});
