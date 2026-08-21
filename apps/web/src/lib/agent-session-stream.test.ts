import assert from "node:assert/strict";
import test from "node:test";

import type { ListAgentSessionsResponse } from "@agent-orchestrator/shared";

import {
  applyAgentSessionStreamEvent,
  parseAgentSessionStreamEvent,
} from "./agent-session-stream.js";

const initial: ListAgentSessionsResponse = {
  items: [
    {
      id: "agent-1",
      workspaceId: "default",
      sourceType: "local",
      agentKind: "codex",
      displayName: "Agent 1",
      workingDirectory: "/workspace",
      connectionState: "online",
      interactionState: "idle",
    },
    {
      id: "agent-2",
      workspaceId: "default",
      sourceType: "local",
      agentKind: "codex",
      displayName: "Agent 2",
      workingDirectory: "/workspace",
      connectionState: "online",
      interactionState: "idle",
    },
  ],
  activeAgentSessionId: null,
  updatedAt: "2026-08-21T00:00:00.000Z",
};

test("parses and applies a session delta without losing unchanged sessions", () => {
  const event = parseAgentSessionStreamEvent(
    JSON.stringify({
      type: "delta",
      payload: {
        upserts: [{ ...initial.items[0], outputPreview: "changed" }],
        removedIds: ["agent-2"],
        orderedIds: ["agent-1"],
        activeAgentSessionId: "agent-1",
        updatedAt: "2026-08-21T00:00:01.000Z",
      },
    }),
  );

  assert.ok(event);
  assert.deepEqual(applyAgentSessionStreamEvent(initial, event), {
    items: [{ ...initial.items[0], outputPreview: "changed" }],
    activeAgentSessionId: "agent-1",
    updatedAt: "2026-08-21T00:00:01.000Z",
  });
});

test("rejects a delta before the initial snapshot and malformed events", () => {
  const event = parseAgentSessionStreamEvent(
    JSON.stringify({
      type: "delta",
      payload: {
        upserts: [],
        removedIds: [],
        orderedIds: [],
        activeAgentSessionId: null,
        updatedAt: "2026-08-21T00:00:01.000Z",
      },
    }),
  );
  assert.ok(event);
  assert.equal(applyAgentSessionStreamEvent(null, event), null);
  assert.equal(parseAgentSessionStreamEvent('{"type":"delta"}'), null);
});

test("applies the server order even when no record fields changed", () => {
  const next = applyAgentSessionStreamEvent(initial, {
    type: "delta",
    payload: {
      upserts: [],
      removedIds: [],
      orderedIds: ["agent-2", "agent-1"],
      activeAgentSessionId: null,
      updatedAt: "2026-08-21T00:00:01.000Z",
    },
  });
  assert.deepEqual(
    next?.items.map((item) => item.id),
    ["agent-2", "agent-1"],
  );
});
