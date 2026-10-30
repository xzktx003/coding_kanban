import { beforeEach, expect, it } from "vitest";
import { useCCStore } from "../stores/cc/ccStore";
import { useAcpStore } from "../stores/useAcpStore";
import {
  providerTranscriptKey,
  markProviderTranscriptDormant,
  trackProviderTranscript,
  useProviderTranscriptStore,
} from "./sessionProviderTranscriptState";
import { estimateTranscriptBytes } from "./codexTranscriptMemoryBudget";
beforeEach(() => {
  useProviderTranscriptStore.setState({ entries: {} });
  useCCStore.setState({
    activeSessionId: "bounded-cc",
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
  });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    agentId: "agent",
    connectionId: "connection",
    sessionId: "session",
  });
});

it("bounds Claude canonical and selected message references at their first publication", () => {
  useCCStore
    .getState()
    .setMessages(
      Array.from({ length: 700 }, (_, n) => ({
        type: "assistant",
        uuid: String(n),
        message: { content: [{ type: "text", text: "x".repeat(20_000) }] },
      })),
    );
  const state = useCCStore.getState();
  expect(state.messages).toBe(state.sessionMessagesMap["bounded-cc"]);
  expect(state.messages.length).toBeLessThanOrEqual(600);
  expect(estimateTranscriptBytes(state.messages)).toBeLessThanOrEqual(
    8 * 1024 * 1024,
  );
});

it("keeps dormant Claude permission and task outcome metadata without retaining late body messages", () => {
  const owner = providerTranscriptKey("cc", "bounded-cc");
  trackProviderTranscript(owner, "cc", "bounded-cc");
  markProviderTranscriptDormant(owner, 1024);
  useCCStore
    .getState()
    .addMessageToSession("bounded-cc", {
      type: "assistant",
      uuid: "late-body",
      message: { content: [{ type: "text", text: "must not return" }] },
    });
  useCCStore
    .getState()
    .addMessageToSession("bounded-cc", {
      type: "permission_request",
      requestId: "retained-approval",
      sessionId: "bounded-cc",
      toolName: "Read",
      toolInput: { path: "/fixture" },
    });
  useCCStore
    .getState()
    .addMessageToSession("bounded-cc", {
      type: "result",
      session_id: "bounded-cc",
      subtype: "success",
      duration_ms: 10,
      duration_api_ms: 10,
      is_error: false,
      num_turns: 1,
    });
  const rows = useCCStore.getState().sessionMessagesMap["bounded-cc"];
  expect(rows.some((row) => row.type === "assistant")).toBe(false);
  expect(rows.some((row) => row.type === "permission_request")).toBe(true);
  expect(useCCStore.getState().sessionLoadingMap["bounded-cc"]).toBe(false);
});

it("does not let dormant ACP body deltas refill the canonical entries", () => {
  const owner = providerTranscriptKey("acp", "session", "agent", "connection");
  trackProviderTranscript(owner, "acp", "session");
  markProviderTranscriptDormant(owner, 1024);
  useAcpStore.getState().appendChunk("agent", "late body");
  expect(useAcpStore.getState().entries).toEqual([]);
});
