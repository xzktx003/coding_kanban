import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { stabilizeSessionList } from "./session-list-stability.js";

function session(
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "grok",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "vibe",
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    ...overrides,
  };
}

describe("session list stability", () => {
  it("keeps the previous array for an identical snapshot", () => {
    const previous = [session({ lastHeartbeatAt: "2026-09-22T00:00:00.000Z" })];
    const next = [session({ lastHeartbeatAt: "2026-09-22T00:00:00.000Z" })];

    assert.equal(stabilizeSessionList(previous, next), previous);
  });

  it("publishes a changed session when its visible state changes", () => {
    const previous = [session({ interactionState: "idle" })];
    const next = [session({ interactionState: "running" })];
    const stable = stabilizeSessionList(previous, next);

    assert.notEqual(stable, previous);
    assert.equal(stable[0]?.interactionState, "running");
  });
});

it("preserves task, git, tags, heartbeat and transport updates", () => {
  const previous = [session()];
  for (const patch of [
    { lastUserMessageSummary: "new task" },
    { gitBranch: "feature" },
    { tags: ["work"] },
    { lastHeartbeatAt: "now" },
    { sshTarget: { host: "test-host", port: 2222 } },
    { transportRef: { processId: 1234 } },
  ]) {
    const next = [session(patch)];
    assert.deepEqual(stabilizeSessionList(previous, next), next);
  }
});

it("reuses unchanged sessions across insertion and reorder", () => {
  const previous = [session(), session({ id: "other", tags: ["work"] })];
  const next = [
    structuredClone(previous[1]!),
    session({ id: "new" }),
    structuredClone(previous[0]!),
  ];
  const stable = stabilizeSessionList(previous, next);
  assert.equal(stable[0], previous[1]);
  assert.equal(stable[2], previous[0]);
});
