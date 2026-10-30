import { beforeEach, expect, test } from "vitest";
import { activeDraftOwner, useInputStore } from "./useInputStore";
import { useAcpStore } from "./useAcpStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "./useSessionDraftStore";
beforeEach(() => {
  useAcpStore.getState().reset();
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useAcpStore.setState({
    active: true,
    agentId: "same-agent",
    connectionId: "A",
    sessionId: "s1",
    historySessionId: "history-A",
  });
});
test("file and skill actions append into the same exact source owner as the ACP composer", () => {
  const a = sessionDraftKey("acp", "history-A", "/fixture", "same-agent"),
    b = sessionDraftKey("acp", "history-B", "/fixture", "same-agent");
  useSessionDraftStore.getState().setText(a, "A draft");
  useSessionDraftStore.getState().setText(b, "B draft");
  useInputStore.getState().appendInputValue("File A");
  expect(activeDraftOwner()).toBe(a);
  expect(readDraft(a).text).toContain("File A");
  expect(readDraft(b).text).toBe("B draft");
  useAcpStore.setState({ connectionId: "B", historySessionId: "history-B" });
  useInputStore.getState().appendInputValue("File B");
  expect(activeDraftOwner()).toBe(b);
  expect(readDraft(b).text).toContain("File B");
  expect(readDraft(a).text).not.toContain("File B");
});
test("old live connections without source metadata still isolate two repeated native IDs", () => {
  useAcpStore.setState({ historySessionId: null });
  const a = activeDraftOwner();
  useAcpStore.setState({ connectionId: "B" });
  const b = activeDraftOwner();
  expect(a).not.toBe(b);
  expect(a).not.toBe(sessionDraftKey("acp", "s1", "/fixture", "same-agent"));
});
