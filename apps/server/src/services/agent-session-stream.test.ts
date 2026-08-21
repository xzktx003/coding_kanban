import assert from "node:assert/strict";
import test from "node:test";

import type { ListAgentSessionsResponse } from "@agent-orchestrator/shared";

import { createAgentSessionStreamEvent } from "./agent-session-stream.js";

function snapshot(
  items: ListAgentSessionsResponse["items"],
  activeAgentSessionId: string | null = null,
): ListAgentSessionsResponse {
  return {
    items,
    activeAgentSessionId,
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

const session = {
  id: "agent-1",
  workspaceId: "default",
  sourceType: "local" as const,
  agentKind: "codex" as const,
  displayName: "Agent 1",
  workingDirectory: "/workspace",
  connectionState: "online" as const,
  interactionState: "idle" as const,
};

test("agent session stream starts with a full snapshot", () => {
  assert.deepEqual(createAgentSessionStreamEvent(null, snapshot([session])), {
    type: "snapshot",
    payload: snapshot([session]),
  });
});

test("agent session stream sends only changed and removed sessions", () => {
  const previous = snapshot([
    session,
    { ...session, id: "agent-2", displayName: "Agent 2" },
  ]);
  const current = {
    ...snapshot([{ ...session, outputPreview: "new output" }], "agent-1"),
    updatedAt: "2026-08-21T00:00:01.000Z",
  };

  assert.deepEqual(createAgentSessionStreamEvent(previous, current), {
    type: "delta",
    payload: {
      upserts: [{ ...session, outputPreview: "new output" }],
      removedIds: ["agent-2"],
      orderedIds: ["agent-1"],
      activeAgentSessionId: "agent-1",
      updatedAt: "2026-08-21T00:00:01.000Z",
    },
  });
});

test("one busy session no longer retransmits the other session records", () => {
  const items = Array.from({ length: 23 }, (_, index) => ({
    ...session,
    id: `agent-${index}`,
    displayName: `Agent ${index}`,
    outputPreview: `stable output ${index}`,
  }));
  const previous = snapshot(items);
  const current = {
    ...snapshot([
      { ...items[0]!, outputPreview: "only this output changed" },
      ...items.slice(1),
    ]),
    updatedAt: "2026-08-21T00:00:01.000Z",
  };
  const event = createAgentSessionStreamEvent(previous, current);

  assert.equal(event.type, "delta");
  if (event.type === "delta") {
    assert.equal(event.payload.upserts.length, 1);
    assert.ok(
      Buffer.byteLength(JSON.stringify(event)) <
        Buffer.byteLength(
          JSON.stringify({ type: "snapshot", payload: current }),
        ) /
          3,
    );
  }
});
