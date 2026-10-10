import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@session/hooks/runtime", () => ({
  buildEventUrl: (path: string) => path,
  isDesktopTauri: () => false,
}));

import { openEventStream } from "@session/lib/eventStream";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAcpEvents } from "./useAcpEvents";

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
  vi.stubGlobal("EventSource", FakeSource);
  useAcpStore.setState({
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
