import assert from "node:assert/strict";
import test from "node:test";

import type { CheckoutDiffResponse } from "@agent-orchestrator/shared";
import Fastify from "fastify";

import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { registerAgentSessionRoutes } from "./agent-sessions.js";

const emptyCheckoutDiff: CheckoutDiffResponse = {
  available: true,
  scope: "checkout",
  changedFiles: 0,
  addedLines: 0,
  deletedLines: 0,
  files: [],
  generatedAt: "2026-08-19T00:00:00.000Z",
};

function routeDependencies(registry: AgentSessionRegistry) {
  return {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {} as never,
    localTmuxInputRouter: {} as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {} as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {} as never,
  };
}

test("POST git hunk revert binds the requested hunk to the local session checkout", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "local checkout",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "idle",
  });
  let received: {
    directory?: string;
    path?: string;
    hunkIndex?: number;
    hunkHeader?: string;
  } = {};

  await registerAgentSessionRoutes(app, {
    ...routeDependencies(registry),
    gitChangesService: {
      async read() {
        return emptyCheckoutDiff;
      },
      async revertHunk(directory, path, hunkIndex, hunkHeader) {
        received = { directory, path, hunkIndex, hunkHeader };
        return { ok: true, path, hunkIndex, hunkHeader };
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/agent-sessions/${session.id}/git-changes/revert-hunk`,
    payload: {
      path: "apps/web/src/App.tsx",
      hunkIndex: 1,
      hunkHeader: "@@ -20,3 +20,4 @@",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    directory: "/workspace/project",
    path: "apps/web/src/App.tsx",
    hunkIndex: 1,
    hunkHeader: "@@ -20,3 +20,4 @@",
  });
  assert.deepEqual(response.json(), {
    ok: true,
    path: "apps/web/src/App.tsx",
    hunkIndex: 1,
    hunkHeader: "@@ -20,3 +20,4 @@",
  });
  await app.close();
});

test("POST git hunk revert rejects remote sessions before touching local Git", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "remote.example",
    sourceType: "remote-connect",
    agentKind: "codex",
    displayName: "remote checkout",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "idle",
    sshTarget: { host: "remote.example", port: 22 },
  });
  let revertCalled = false;

  await registerAgentSessionRoutes(app, {
    ...routeDependencies(registry),
    gitChangesService: {
      async read() {
        return emptyCheckoutDiff;
      },
      async revertHunk() {
        revertCalled = true;
        return {
          ok: true,
          path: "tracked.txt",
          hunkIndex: 0,
          hunkHeader: "@@ -1 +1 @@",
        };
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/agent-sessions/${session.id}/git-changes/revert-hunk`,
    payload: {
      path: "tracked.txt",
      hunkIndex: 0,
      hunkHeader: "@@ -1 +1 @@",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(revertCalled, false);
  assert.deepEqual(response.json(), { error: "远端 Git 改动块暂不支持还原" });
  await app.close();
});
