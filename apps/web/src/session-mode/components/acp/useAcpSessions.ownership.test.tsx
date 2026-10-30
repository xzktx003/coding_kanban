import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  useAcpRuntimeOwnersStore,
  rememberCurrentAcpOwner,
} from "@session/services/acpRuntimeOwners";
import { buildUrl } from "@session/hooks/runtime";
import type { AcpSessionRecord } from "@session/services/apiAdapt/acp";
import { useAcpSessions } from "./useAcpSessions";
const api = vi.hoisted(() => ({
  load: vi.fn(),
  start: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  fresh: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpListSessions: api.list,
  acpLoadSession: api.load,
  acpStart: api.start,
  acpNewSession: vi.fn(),
  acpGetSession: vi.fn(),
  acpDeleteSession: api.remove,
  acpCancel: api.cancel,
  acpStop: vi.fn(),
}));
vi.mock("./newSession", () => ({ acpFreshSession: api.fresh }));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
const record = (
  sessionId: string,
  cwd = "/fixture/project",
): AcpSessionRecord => ({
  sessionId,
  cwd,
  agentId: "fixture-agent",
  agentTitle: "Fixture",
  title: sessionId,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  api.remove.mockResolvedValue(undefined);
  api.fresh.mockResolvedValue(false);
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "fixture-agent",
    connectionId: "fixture-connection",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "initial",
    historySessionId: "source-initial",
    sessionCwd: "/current",
    canLoadSession: true,
  });
  useWorkspaceStore.setState({ cwd: "/current" });
});
test("opening a stored ACP record only reads its source and preserves the current task target", async () => {
  const entries = [
    { id: "current", role: "agent" as const, text: "keep current body" },
  ];
  useAcpStore.setState({ entries, running: true });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await act(() => hook.result.current.open(record("history")));
  expect(api.load).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    sessionId: "initial",
    historySessionId: "source-initial",
    running: true,
    entries,
    sessionCwd: "/current",
    inheritedHistory: { sessionId: "history", viewOnly: true },
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/current");
  expect(hook.result.current.confirmation).toBeNull();
});
test("two project selections do not issue mutating RPCs or change the current context", async () => {
  const old = renderHook(() => useAcpSessions("/old")),
    next = renderHook(() => useAcpSessions("/new"));
  await act(() => old.result.current.open(record("source-old", "/old")));
  await act(() => next.result.current.open(record("source-new", "/new")));
  expect(useAcpStore.getState().inheritedHistory?.sessionId).toBe("source-new");
  expect(useAcpStore.getState().sessionId).toBe("initial");
  expect(api.load).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});
test("same native ID in two live connections cannot choose the latest wrong history source", async () => {
  useAcpStore.setState({
    sessionId: "same",
    historySessionId: "source-A",
    sessionCwd: "/A",
  });
  rememberCurrentAcpOwner();
  useAcpStore.setState({
    connectionId: "connection-B",
    sessionId: "same",
    historySessionId: "source-B",
    sessionCwd: "/B",
  });
  const b = rememberCurrentAcpOwner()!;
  useAcpRuntimeOwnersStore.setState((s) => ({
    owners: { ...s.owners, [b.key]: { ...b, lastUsed: Date.now() + 1000 } },
  }));
  const hook = renderHook(() => useAcpSessions("/A"));
  await act(() =>
    hook.result.current.open({
      ...record("source-A", "/A"),
      nativeSessionId: "same",
    }),
  );
  expect(useAcpStore.getState().historySessionId).toBe("source-A");
  expect(useWorkspaceStore.getState().cwd).toBe("/A");
  expect(api.load).not.toHaveBeenCalled();
});
test("opening the exact current source restores its project without native load", async () => {
  useAcpStore.setState({ running: true, sessionCwd: null });
  useWorkspaceStore.setState({ cwd: "/browsed" });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await act(() => hook.result.current.open(record("source-initial")));
  expect(useAcpStore.getState()).toMatchObject({
    sessionId: "initial",
    running: true,
    sessionCwd: "/fixture/project",
    inheritedHistory: null,
  });
  expect(api.load).not.toHaveBeenCalled();
});
test("revoked list scope cannot open an old record", async () => {
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const { invalidateCodexOperationScope } =
    await import("@session/services/codexOperationScope");
  invalidateCodexOperationScope();
  await act(() => hook.result.current.open(record("history")));
  expect(useAcpStore.getState().inheritedHistory).toBeNull();
  expect(hook.result.current.error).toContain("变化");
});
test("deleting a running current source preserves its history and never interrupts", async () => {
  useAcpStore.setState({ running: true });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await expect(
    hook.result.current.remove(record("source-initial")),
  ).rejects.toThrow("任务");
  expect(api.remove).not.toHaveBeenCalled();
  expect(api.fresh).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});
test("deleting a background source with pending approval is blocked", async () => {
  useAcpStore.setState({ permission: { requestId: "approval" } as any });
  rememberCurrentAcpOwner();
  useAcpStore.setState({
    connectionId: "B",
    sessionId: "other",
    historySessionId: "source-B",
    permission: null,
  });
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await expect(
    hook.result.current.remove(record("source-initial")),
  ).rejects.toThrow(/任务|审批/);
  expect(api.remove).not.toHaveBeenCalled();
});
test("failed idle replacement cannot destroy the current history record", async () => {
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await expect(
    hook.result.current.remove(record("source-initial")),
  ).rejects.toThrow("新会话");
  expect(api.remove).not.toHaveBeenCalled();
  expect(useAcpStore.getState().sessionId).toBe("initial");
});

test("scope revocation while replacing idle context cannot delete the old source through new credentials", async () => {
  let finish!: (v: boolean) => void;
  api.fresh.mockReturnValueOnce(new Promise((r) => (finish = r)));
  const hook = renderHook(() => useAcpSessions("/fixture/project"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const pending = hook.result.current.remove(record("source-initial"));
  let failure: unknown;
  const settled = pending.catch((e) => {
    failure = e;
  });
  await waitFor(() => expect(api.fresh).toHaveBeenCalledOnce());
  const { invalidateCodexOperationScope } =
    await import("@session/services/codexOperationScope");
  invalidateCodexOperationScope();
  await act(async () => {
    finish(true);
    await settled;
  });
  expect(failure).toBeInstanceOf(Error);
  expect(api.remove).not.toHaveBeenCalled();
});
