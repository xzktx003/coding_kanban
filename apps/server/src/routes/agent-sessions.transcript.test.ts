import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptResponse } from "@agent-orchestrator/shared";
import Fastify from "fastify";

import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { registerAgentSessionRoutes } from "./agent-sessions.js";

test("GET transcript resolves a local Codex record from the registered session", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "node",
    displayName: "codex pane",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "running",
    agentSessionId: "codex-session-id",
  });
  let receivedInput: unknown;

  await registerAgentSessionRoutes(app, {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {} as never,
    localTmuxInputRouter: {} as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {} as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {} as never,
    codexTranscriptService: {
      read(input) {
        receivedInput = input;
        return {
          available: true,
          agentKind: "codex",
          sessionId: "codex-session-id",
          matchedBy: "session-id",
          updatedAt: "2026-08-13T01:00:00.000Z",
          entries: [],
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/transcript`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    sessionId: "codex-session-id",
    workingDirectory: "/workspace/project",
  });
  assert.equal(
    (response.json() as AgentTranscriptResponse).matchedBy,
    "session-id",
  );
  await app.close();
});

test("GET transcript does not read local Codex files for remote sessions", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "remote.example",
    sourceType: "remote-connect",
    agentKind: "codex",
    displayName: "remote codex",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "running",
    sshTarget: { host: "remote.example", port: 22 },
  });
  let readCalled = false;

  await registerAgentSessionRoutes(app, {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {} as never,
    localTmuxInputRouter: {} as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {} as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {} as never,
    codexTranscriptService: {
      read() {
        readCalled = true;
        throw new Error("must not read local files");
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/transcript`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(readCalled, false);
  assert.equal((response.json() as AgentTranscriptResponse).available, false);
  await app.close();
});
