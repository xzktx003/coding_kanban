import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@session/hooks/runtime", () => ({
  buildEventUrl: (path: string) => path,
  isDesktopTauri: () => false,
}));

import { openEventStream } from "@session/lib/eventStream";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAcpEvents } from "./useAcpEvents";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  updateProviderTranscript,
  useProviderTranscriptStore,
} from "@session/services/sessionProviderTranscriptState";

class FakeSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    instances.push(this);
  }
}

const instances: FakeSource[] = [];

const emit = (
  seq: number,
  payload: Record<string, unknown>,
  event = "acp-message",
) =>
  act(() =>
    instances[0].onmessage?.({
      data: JSON.stringify({ seq, event, payload }),
    }),
  );

beforeEach(() => {
  instances.length = 0;
  useProviderTranscriptStore.setState({ entries: {} });
  vi.stubGlobal("EventSource", FakeSource);
  useAcpStore.setState({
    agentId: "agent",
    connectionId: "conn",
    sessionId: "session",
    entries: [],
    permission: null,
    pendingPermissions: {},
    authenticating: null,
    authNotice: null,
    running: true,
  });
});

it("binds persisted prompt acknowledgements and live source IDs to the exact current agent/connection/session", () => {
  useAcpStore
    .getState()
    .addEntry({
      id: "optimistic",
      role: "user",
      text: "same text",
      clientMessageId: "client-one",
    });
  const { unmount } = renderHook(() => useAcpEvents("conn"));
  try {
    emit(1, {
      connectionId: "conn",
      agentId: "wrong-agent",
      sessionId: "session",
      kind: "prompt-persisted",
      clientMessageId: "client-one",
      sourceRows: [{ historySourceId: 1, partIndex: 0 }],
    });
    expect(useAcpStore.getState().entries[0].id).toBe("optimistic");
    emit(2, {
      connectionId: "conn",
      agentId: "agent",
      sessionId: "session",
      kind: "prompt-persisted",
      clientMessageId: "client-one",
      historySourceId: 1,
      sourceRows: [{ historySourceId: 1, partIndex: 0 }],
    });
    expect(useAcpStore.getState().entries[0]).toMatchObject({
      id: "acp-1-0",
      historySourceId: 1,
      clientMessageId: "client-one",
    });
    const source = {
      connectionId: "conn",
      agentId: "agent",
      sessionId: "session",
      kind: "update",
      historySourceId: 2,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "once" },
      },
    };
    emit(3, source);
    emit(4, source);
    expect(useAcpStore.getState().entries[1]).toMatchObject({
      id: "acp-2-0",
      text: "once",
      historySourceId: 2,
    });
    expect(useAcpStore.getState().entries).toHaveLength(2);
  } finally {
    unmount();
  }
});

afterEach(() => vi.unstubAllGlobals());

it("uses the shared event stream and filters ACP updates by connection and session", () => {
  const codex = vi.fn();
  const closeCodex = openEventStream({ agents: ["codex"], onEvent: codex });
  const { unmount } = renderHook(() => useAcpEvents("conn"));

  try {
    expect(instances).toHaveLength(1);
    emit(1, {
      connectionId: "other",
      agentId: "agent",
      kind: "update",
      sessionId: "session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "wrong connection" },
      },
    });
    emit(2, {
      connectionId: "conn",
      agentId: "agent",
      kind: "update",
      sessionId: "other-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "wrong session" },
      },
    });
    emit(3, {
      connectionId: "conn",
      agentId: "agent",
      kind: "update",
      sessionId: "session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "visible" },
      },
    });

    expect(useAcpStore.getState().entries).toMatchObject([
      { role: "agent", text: "visible" },
    ]);
    expect(codex).not.toHaveBeenCalled();
  } finally {
    unmount();
    closeCodex();
  }
  expect(instances[0].close).toHaveBeenCalledOnce();
});

it("queues permissions by ACP session without opening another SSE connection", () => {
  const closeCodex = openEventStream({ agents: ["codex"], onEvent: vi.fn() });
  const { unmount } = renderHook(() => useAcpEvents("conn"));

  try {
    expect(instances).toHaveLength(1);
    emit(1, {
      connectionId: "conn",
      agentId: "agent",
      kind: "permission",
      sessionId: "other-session",
      requestId: "other-request",
      toolCall: { title: "Other session", kind: "execute" },
      options: [{ optionId: "allow", name: "Allow" }],
    });
    expect(useAcpStore.getState().permission).toBeNull();
    expect(useAcpStore.getState().pendingPermissions).toHaveProperty(
      JSON.stringify(["conn", "other-session"]),
    );

    emit(2, {
      connectionId: "conn",
      agentId: "agent",
      kind: "permission",
      sessionId: "session",
      requestId: "current-request",
      toolCall: { title: "Current session", kind: "read" },
      options: [{ optionId: "allow", name: "Allow" }],
    });
    expect(useAcpStore.getState().permission).toMatchObject({
      requestId: "current-request",
      title: "Current session",
      toolKind: "read",
    });
  } finally {
    unmount();
    closeCodex();
  }
  expect(instances[0].close).toHaveBeenCalledOnce();
});

// The persistent App bridge stays mounted when its provider pane is hidden.
it("keeps background approvals and mode state without resurrecting a reclaimed legacy body", () => {
  const owner = providerTranscriptKey("acp", "session", "agent", "conn");
  trackProviderTranscript(owner, "acp", "session");
  updateProviderTranscript(owner, { dormant: true });
  useAcpStore.setState({ active: false });
  const { unmount } = renderHook(() => useAcpEvents("conn"));
  try {
    emit(1, {
      connectionId: "conn",
      agentId: "agent",
      sessionId: "session",
      kind: "update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late untagged body" },
      },
    });
    emit(2, {
      connectionId: "conn",
      agentId: "agent",
      sessionId: "session",
      kind: "permission",
      requestId: "background",
      toolCall: { title: "Background request" },
      options: [{ optionId: "allow", name: "Allow" }],
    });
    expect(useAcpStore.getState().entries).toHaveLength(0);
    expect(useAcpStore.getState().permission?.requestId).toBe("background");
  } finally {
    unmount();
  }
});
