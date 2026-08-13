import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  loadAgentGridSortMode,
  saveAgentGridSortMode,
  sortAgentSessions,
} from "./agent-grid-sort.js";

function session(
  id: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: id,
    connectionState: "online",
    interactionState: "idle",
    ...overrides,
  };
}

test("sorts sessions by recent activity, project and name", () => {
  const sessions = [
    session("zeta", {
      displayName: "Zeta",
      projectName: "alpha-project",
      lastOutputAt: "2026-08-13T01:00:00.000Z",
    }),
    session("alpha", {
      displayName: "Alpha",
      projectName: "beta-project",
      lastOutputAt: "2026-08-13T03:00:00.000Z",
    }),
    session("beta", {
      displayName: "Beta",
      projectName: "alpha-project",
      lastOutputAt: "2026-08-13T02:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    sortAgentSessions(sessions, "recent").map((item) => item.id),
    ["alpha", "beta", "zeta"],
  );
  assert.deepEqual(
    sortAgentSessions(sessions, "project").map((item) => item.id),
    ["beta", "zeta", "alpha"],
  );
  assert.deepEqual(
    sortAgentSessions(sessions, "name").map((item) => item.id),
    ["alpha", "beta", "zeta"],
  );
});

test("persists valid sort mode and falls back for invalid storage", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });

  saveAgentGridSortMode("project");
  assert.equal(loadAgentGridSortMode(), "project");
  values.set("coding-kanban-agent-grid-sort-v1", "invalid");
  assert.equal(loadAgentGridSortMode(), "recent");
});
