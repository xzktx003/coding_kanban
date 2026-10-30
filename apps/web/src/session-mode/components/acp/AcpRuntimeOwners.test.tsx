import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { AcpRuntimeOwners } from "./AcpRuntimeOwners";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  rememberCurrentAcpOwner,
  useAcpRuntimeOwnersStore,
  noteAcpOwnerEvent,
} from "@session/services/acpRuntimeOwners";
import { buildUrl } from "@session/hooks/runtime";
beforeEach(() => {
  sessionStorage.clear();
  useAcpRuntimeOwnersStore.setState({ owners: {} });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "A",
    agentTitle: "Agent A",
    runtimeInstance: "runtime",
    connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
    connectionId: "connection-A",
    sessionId: "session-A",
    sessionCwd: "/fixture/A",
    running: true,
  });
});
it("shows an old running approval while Codex receives input and returns only through a readonly barrier", () => {
  const owner = rememberCurrentAcpOwner()!;
  useAcpStore.getState().setActive(false);
  noteAcpOwnerEvent({
    agentId: "A",
    connectionId: "connection-A",
    sessionId: "session-A",
    kind: "permission",
    requestId: "permission-A",
    toolCall: { title: "Read A" },
  });
  const view = render(<AcpRuntimeOwners />);
  expect(screen.getByText(/待审批 1/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "返回 Agent A · session-" }),
  );
  expect(useAcpStore.getState()).toMatchObject({
    active: true,
    agentId: "A",
    connectionId: null,
    connectionRecovery: "recovering",
  });
  expect(
    useAcpRuntimeOwnersStore.getState().owners[owner.key].pendingCount,
  ).toBe(1);
  view.unmount();
});
it("same-native-id owners remain separately identifiable in navigation", () => {
  useAcpStore.setState({
    sessionId: "s1",
    historySessionId: "history-AAAAAAAA",
  });
  rememberCurrentAcpOwner();
  useAcpStore.setState({
    connectionId: "connection-B",
    historySessionId: "history-BBBBBBBB",
  });
  rememberCurrentAcpOwner();
  useAcpStore.getState().setActive(false);
  render(<AcpRuntimeOwners />);
  expect(
    screen.getByRole("button", { name: "返回 Agent A · AAAAAAAA" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "返回 Agent A · BBBBBBBB" }),
  ).toBeTruthy();
});
