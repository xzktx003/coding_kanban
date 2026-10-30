import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("./apiAdapt/acp", () => ({ acpReadConnectionSnapshot: api.snapshot }));
import { useAcpStore } from "../stores/useAcpStore";
import { buildUrl } from "../hooks/runtime";
import {
  rememberCurrentAcpOwner,
  useAcpRuntimeOwnersStore,
  noteAcpOwnerEvent,
  openAcpRuntimeOwner,
  startAcpRuntimeOwners,
  findAcpRuntimeOwnerByHistory,
  refreshKnownAcpRuntimeOwners,
} from "./acpRuntimeOwners";
let stop: (() => void) | undefined;
beforeEach(() => {
  api.snapshot.mockReset();
  sessionStorage.clear();
  useAcpStore.getState().reset();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useAcpStore.setState({
    active: true,
    agentId: "A",
    agentTitle: "Agent A",
    connectionId: "connection-A",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "session-A",
    sessionCwd: "/fixture/A",
    running: true,
  });
});
for (const historySessionId of ["other-source", "session-A"])
  it(`background snapshots reject a changed or native-only source (${historySessionId})`, async () => {
    useAcpStore.setState({ historySessionId: "exact-source" });
    const owner = rememberCurrentAcpOwner()!;
    api.snapshot.mockResolvedValue({
      runtimeInstance: "runtime",
      connectionId: "connection-A",
      agentId: "A",
      sessionId: "session-A",
      historySessionId,
      cwd: "/fixture/A",
      running: false,
      permissions: [],
    });
    await refreshKnownAcpRuntimeOwners([owner.key]);
    expect(useAcpRuntimeOwnersStore.getState().owners[owner.key]).toMatchObject(
      { historySessionId: "exact-source", verified: false, running: true },
    );
  });
afterEach(() => stop?.());
it("keeps only owner metadata while another provider receives input and late approvals stay on their exact old owner", () => {
  stop = startAcpRuntimeOwners();
  const a = rememberCurrentAcpOwner()!;
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "B",
    connectionId: "connection-B",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    sessionId: "session-B",
    sessionCwd: "/fixture/B",
  });
  rememberCurrentAcpOwner();
  expect(
    noteAcpOwnerEvent({
      agentId: "A",
      connectionId: "connection-A",
      sessionId: "session-A",
      kind: "permission",
      requestId: "approval-A",
      toolCall: { title: "Read A" },
      options: [{ optionId: "allow", name: "Allow" }],
    }),
  ).toBe(true);
  expect(useAcpRuntimeOwnersStore.getState().owners[a.key]).toMatchObject({
    running: true,
    pendingCount: 1,
    permissionTitles: ["Read A"],
  });
  expect(useAcpStore.getState().permission).toBeNull();
  expect(JSON.stringify(useAcpRuntimeOwnersStore.getState())).not.toContain(
    "options",
  );
  expect(
    noteAcpOwnerEvent({
      agentId: "wrong",
      connectionId: "connection-A",
      sessionId: "session-A",
      kind: "permission",
      requestId: "intruder",
    }),
  ).toBe(false);
  openAcpRuntimeOwner(a.key);
  expect(useAcpStore.getState()).toMatchObject({
    active: true,
    agentId: "A",
    connectionId: null,
    connectionRecovery: "recovering",
  });
  expect(useAcpRuntimeOwnersStore.getState().owners[a.key].pendingCount).toBe(
    1,
  );
});
it("a terminal metadata event settles only its own task and the registry never stores transcript bodies", () => {
  stop = startAcpRuntimeOwners();
  const a = rememberCurrentAcpOwner()!;
  noteAcpOwnerEvent({
    agentId: "A",
    connectionId: "connection-A",
    sessionId: "session-A",
    kind: "execution-state",
    running: false,
    deliveryUnknown: false,
    lifecycleUnknown: false,
  });
  expect(useAcpRuntimeOwnersStore.getState().owners[a.key].running).toBe(false);
  useAcpStore
    .getState()
    .setEntries([{ id: "large", role: "agent", text: "private body" }]);
  expect(JSON.stringify(useAcpRuntimeOwnersStore.getState())).not.toContain(
    "private body",
  );
});
it("history lookup never substitutes the most recent process with the same native session id", () => {
  useAcpStore.setState({ sessionId: "s1", historySessionId: "source-A" });
  const a = rememberCurrentAcpOwner()!;
  useAcpStore.setState({
    connectionId: "connection-B",
    historySessionId: "source-B",
  });
  const b = rememberCurrentAcpOwner()!;
  expect(findAcpRuntimeOwnerByHistory("A", "source-A")?.key).toBe(a.key);
  expect(findAcpRuntimeOwnerByHistory("A", "source-B")?.key).toBe(b.key);
  expect(findAcpRuntimeOwnerByHistory("A", "s1")).toBeUndefined();
  expect(findAcpRuntimeOwnerByHistory("other", "source-A")).toBeUndefined();
});
