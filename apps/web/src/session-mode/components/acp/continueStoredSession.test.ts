import { beforeEach, expect, it, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  rememberCurrentAcpOwner,
  useAcpRuntimeOwnersStore,
} from "@session/services/acpRuntimeOwners";
import { buildUrl } from "@session/hooks/runtime";
import { captureHistorySourceScope } from "../history/historySourceScope";
import { continueStoredAcpSession } from "./continueStoredSession";
const api = vi.hoisted(() => ({
  start: vi.fn(),
  load: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpStart: api.start,
  acpLoadSession: api.load,
  acpStop: api.stop,
  acpCancel: api.cancel,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
const source = {
  sessionId: "source-old",
  nativeSessionId: "native-old",
  agentId: "agent",
  title: "Stored",
  cwd: "/stored",
  viewOnly: true,
};
const started = () => ({
  runtimeInstance: "runtime",
  connectionId: "new-connection",
  sessionId: "fresh-native",
  historySessionId: "fresh-source",
  initialize: { agentCapabilities: { loadSession: true } },
  session: { sessionId: "fresh-native", historySessionId: "fresh-source" },
  sessionError: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "agent",
    connectionId: "original",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "native-A",
    historySessionId: "source-A",
    sessionCwd: "/A",
    running: true,
    entries: [{ id: "A", role: "agent", text: "keep A" }],
  });
  useWorkspaceStore.setState({ cwd: "/A" });
  api.start.mockResolvedValue(started());
  api.load.mockResolvedValue({
    sessionId: "native-old",
    historySessionId: "new-source-old",
  });
  api.stop.mockResolvedValue(undefined);
});
it("explicit continue creates B, loads native ID, and keeps running A registered", async () => {
  await continueStoredAcpSession(source);
  expect(api.start).toHaveBeenCalledExactlyOnceWith("agent", "/stored");
  expect(api.load).toHaveBeenCalledExactlyOnceWith(
    "new-connection",
    "native-old",
    "/stored",
  );
  expect(api.stop).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "new-connection",
    sessionId: "native-old",
    historySessionId: "new-source-old",
    inheritedHistory: null,
    sessionTransition: null,
    sessionTransitionError: null,
  });
  expect(Object.values(useAcpRuntimeOwnersStore.getState().owners)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        connectionId: "original",
        running: true,
        historySessionId: "source-A",
      }),
    ]),
  );
});
it("unsupported load retains old records as readonly beside fresh context", async () => {
  api.start.mockResolvedValue({
    ...started(),
    initialize: { agentCapabilities: { loadSession: false } },
  });
  await continueStoredAcpSession(source);
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState()).toMatchObject({
    sessionId: "fresh-native",
    historySessionId: "fresh-source",
    inheritedHistory: { sessionId: "source-old", viewOnly: false },
  });
});
it("legacy source without native identity never loads its historical source ID", async () => {
  await continueStoredAcpSession({ ...source, nativeSessionId: undefined });
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState().inheritedHistory?.sessionId).toBe("source-old");
});
it("two live owners with same native ID return only the exact stored source", async () => {
  useAcpStore.setState({ sessionId: "same", historySessionId: "source-old" });
  const a = rememberCurrentAcpOwner()!;
  useAcpStore.setState({
    connectionId: "B",
    sessionId: "same",
    historySessionId: "source-B",
  });
  const b = rememberCurrentAcpOwner()!;
  useAcpRuntimeOwnersStore.setState((s) => ({
    owners: { ...s.owners, [b.key]: { ...b, lastUsed: Date.now() + 10000 } },
  }));
  await continueStoredAcpSession({ ...source, nativeSessionId: "same" });
  expect(api.start).not.toHaveBeenCalled();
  expect(api.load).not.toHaveBeenCalled();
  expect(useAcpStore.getState().historySessionId).toBe(a.historySessionId);
});
it("load failure blocks sending on B and preserves A instead of pretending A context was restored", async () => {
  api.load.mockRejectedValueOnce(new Error("native rejected"));
  await expect(continueStoredAcpSession(source)).rejects.toThrow(
    "native rejected",
  );
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "new-connection",
    sessionId: "native-old",
    sessionTransition: null,
  });
  expect(useAcpStore.getState().sessionTransitionError).toContain(
    "native rejected",
  );
  expect(
    Object.values(useAcpRuntimeOwnersStore.getState().owners).some(
      (o) => o.connectionId === "original" && o.running,
    ),
  ).toBe(true);
  expect(api.cancel).not.toHaveBeenCalled();
});
it("mismatched native load receipt cannot adopt a different target", async () => {
  api.load.mockResolvedValue({
    sessionId: "unexpected",
    historySessionId: "unexpected-source",
  });
  await expect(continueStoredAcpSession(source)).rejects.toThrow(/身份|目标/);
  expect(useAcpStore.getState().sessionId).toBe("native-old");
  expect(useAcpStore.getState().sessionTransitionError).toBeTruthy();
});
it("a delayed start never changes a newer current selection and cleans only its unused created connection", async () => {
  let resolve!: (r: ReturnType<typeof started>) => void;
  api.start.mockReturnValue(new Promise((r) => (resolve = r)));
  const pending = continueStoredAcpSession(source);
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  useAcpStore.setState({
    connectionId: "C",
    sessionId: "native-C",
    historySessionId: "source-C",
  });
  resolve(started());
  await pending;
  expect(useAcpStore.getState().connectionId).toBe("C");
  expect(api.stop).toHaveBeenCalledExactlyOnceWith("new-connection");
  expect(api.load).not.toHaveBeenCalled();
});
it("same-account scope revocation while start is held cannot load or replace old target", async () => {
  const sourceScope = captureHistorySourceScope("/api/acp/session");
  let resolve!: (r: ReturnType<typeof started>) => void;
  api.start.mockReturnValue(new Promise((r) => (resolve = r)));
  const pending = continueStoredAcpSession({ ...source, sourceScope });
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  const { invalidateCodexOperationScope } =
    await import("@session/services/codexOperationScope");
  invalidateCodexOperationScope();
  resolve(started());
  await pending;
  expect(api.load).not.toHaveBeenCalled();
  expect(api.stop).not.toHaveBeenCalled();
  expect(useAcpStore.getState().connectionId).toBe("original");
});
