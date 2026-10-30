import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("./apiAdapt/acp", () => ({
  acpReadConnectionSnapshot: (...args: unknown[]) => api.snapshot(...args),
}));
vi.mock("./acpTranscriptRead", () => ({
  refreshAcpTranscript: vi.fn().mockResolvedValue(undefined),
}));
import { useAcpStore } from "../stores/useAcpStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import {
  ACP_CONNECTION_POINTER_KEY,
  prepareSavedAcpConnection,
} from "./acpConnectionRecoveryPointer";
import { startAcpConnectionRecovery } from "./acpConnectionRecovery";
import { buildUrl } from "../hooks/runtime";
const pointer = {
  version: 1,
  endpoint: "",
  runtimeInstance: "runtime",
  agentId: "agent",
  connectionId: "connection",
  sessionId: "session",
  active: true,
};
let stop: (() => void) | undefined;
beforeEach(() => {
  sessionStorage.clear();
  api.snapshot.mockReset();
  useAcpStore.getState().reset();
  useAcpStore.setState({ active: false, restartNonce: 0 });
  useWorkspaceStore.setState({ cwd: "/unrelated" });
  sessionStorage.setItem(
    ACP_CONNECTION_POINTER_KEY,
    JSON.stringify({
      ...pointer,
      endpoint: buildUrl("/api/acp/connection-snapshot"),
    }),
  );
});
afterEach(() => stop?.());
it("restores a verified running owner and pending approval through readonly metadata without starting or loading an Agent", async () => {
  expect(prepareSavedAcpConnection()).toBe(true);
  expect(useAcpStore.getState()).toMatchObject({
    active: true,
    connectionId: null,
    connectionRecovery: "recovering",
  });
  api.snapshot.mockResolvedValue({
    runtimeInstance: "runtime",
    connectionId: "connection",
    agentId: "agent",
    sessionId: "session",
    historySessionId:"acph_fixture-history",
    cwd: "/source",
    initialize: { agentCapabilities: { loadSession: true }, authMethods: [] },
    session: { sessionId: "session",historySessionId:"acph_fixture-history" },
    settingsKnown: false,
    running: true,
    deliveryUnknown: false,
    lifecycleUnknown: false,
    permissions: [
      {
        requestId: "approval",
        sessionId: "session",
        toolCall: { title: "Read", kind: "read" },
        options: [{ optionId: "allow", name: "Allow" }],
      },
    ],
  });
  stop = startAcpConnectionRecovery();
  await vi.waitFor(() =>
    expect(useAcpStore.getState().connectionRecovery).toBeNull(),
  );
  expect(api.snapshot.mock.calls[0].slice(0, 3)).toEqual([
    "connection",
    "session",
    "runtime",
  ]);
  expect(useAcpStore.getState()).toMatchObject({
    connectionId: "connection",
    sessionId: "session",
    runtimeInstance: "runtime",
    running: true,
    models: null,
  });
  expect(useAcpStore.getState().permission?.requestId).toBe("approval");
  expect(useWorkspaceStore.getState().cwd).toBe("/source");
});
it("keeps a failed or stale runtime recovery explicit and never silently creates a replacement owner", async () => {
  prepareSavedAcpConnection();
  api.snapshot.mockRejectedValue(new Error("runtime identity changed"));
  stop = startAcpConnectionRecovery();
  await vi.waitFor(() =>
    expect(useAcpStore.getState().connectionRecovery).toBe("failed"),
  );
  expect(useAcpStore.getState().connectionId).toBeNull();
  expect(useAcpStore.getState().sessionTransitionError).toMatch(
    /runtime identity changed/,
  );
  expect(sessionStorage.getItem(ACP_CONNECTION_POINTER_KEY)).toContain(
    "connection",
  );
});
it("a late snapshot cannot override an explicit switch away from ACP", async () => {
  let resolve!: (value: unknown) => void;
  api.snapshot.mockReturnValue(new Promise((r) => (resolve = r)));
  prepareSavedAcpConnection();
  stop = startAcpConnectionRecovery();
  await vi.waitFor(() => expect(api.snapshot).toHaveBeenCalledOnce());
  useAcpStore.setState({ active: false, agentId: "different" });
  resolve({
    runtimeInstance: "runtime",
    connectionId: "connection",
    agentId: "agent",
    sessionId: "session",
    historySessionId:"acph_fixture-history",
    cwd: "/source",
    initialize: {},
    session: { sessionId: "session",historySessionId:"acph_fixture-history" },
    settingsKnown: true,
    running: true,
    permissions: [],
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(useAcpStore.getState()).toMatchObject({
    active: false,
    agentId: "different",
    connectionId: null,
  });
});

it("a runtime restart rechecks the same owner and keeps a failed recovery guarded without selecting another provider", async () => {
  prepareSavedAcpConnection();
  api.snapshot.mockResolvedValue({
    runtimeInstance: "runtime",
    connectionId: "connection",
    agentId: "agent",
    sessionId: "session",
    historySessionId:"acph_fixture-history",
    cwd: "/source",
    initialize: {},
    session: { sessionId: "session",historySessionId:"acph_fixture-history" },
    settingsKnown: true,
    running: true,
    permissions: [],
  });
  stop = startAcpConnectionRecovery();
  await vi.waitFor(() =>
    expect(useAcpStore.getState().connectionRecovery).toBeNull(),
  );
  api.snapshot.mockRejectedValue(new Error("runtime changed"));
  window.dispatchEvent(new Event("session-runtime-restarted"));
  await vi.waitFor(() =>
    expect(useAcpStore.getState().connectionRecovery).toBe("failed"),
  );
  expect(useAcpStore.getState()).toMatchObject({
    active: true,
    connectionId: "connection",
    sessionId: "session",
    running: true,
  });
  expect(api.snapshot).toHaveBeenCalledTimes(2);
});
