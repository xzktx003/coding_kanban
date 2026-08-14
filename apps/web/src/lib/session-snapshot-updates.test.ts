import assert from "node:assert/strict";
import test from "node:test";

import type { ListAgentSessionsResponse } from "@agent-orchestrator/shared";

import { updateSessionUnreadCompletion } from "./session-snapshot-updates.js";

const snapshot: ListAgentSessionsResponse = {
  items: [
    {
      id: "session-ready",
      workspaceId: "default",
      sourceType: "local",
      agentKind: "codex",
      displayName: "Ready",
      connectionState: "online",
      interactionState: "idle",
      hasUnreadCompletion: false,
    },
    {
      id: "session-other",
      workspaceId: "default",
      sourceType: "local",
      agentKind: "shell",
      displayName: "Other",
      connectionState: "online",
      interactionState: "idle",
    },
  ],
  activeAgentSessionId: null,
  updatedAt: "2026-08-14T00:00:00.000Z",
};

test("optimistically moves a ready session into completion review", () => {
  const next = updateSessionUnreadCompletion(snapshot, "session-ready", true);

  assert.notEqual(next, snapshot);
  assert.equal(next?.items[0]?.hasUnreadCompletion, true);
  assert.equal(next?.items[1], snapshot.items[1]);
});

test("returns the current snapshot when the unread state is unchanged", () => {
  assert.equal(
    updateSessionUnreadCompletion(snapshot, "session-ready", false),
    snapshot,
  );
});
