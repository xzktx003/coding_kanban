import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentTaskDiffResponse,
  AgentTaskSummaryResponse,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";
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
          hasMore: false,
          nextCursor: null,
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

test("GET transcript forwards the server page cursor and bounded page size", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "paged codex",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "running",
    agentSessionId: "paged-codex-session",
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
          sessionId: "paged-codex-session",
          matchedBy: "session-id",
          updatedAt: "2026-08-21T01:00:00.000Z",
          entries: [],
          hasMore: true,
          nextCursor: "1024",
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/transcript?cursor=2048&limit=30`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedInput, {
    sessionId: "paged-codex-session",
    workingDirectory: "/workspace/project",
    cursor: "2048",
    limit: 30,
  });
  await app.close();
});

test("GET transcript keeps two tmux panes in the same directory on distinct Codex sessions", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const first = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "first codex",
    workingDirectory: "/workspace/shared",
    connectionState: "online",
    interactionState: "running",
    transportRef: { tmuxSession: "tmux-a" },
    agentSessionId: "stale-codex-session",
  });
  const second = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "second codex",
    workingDirectory: "/workspace/shared",
    connectionState: "online",
    interactionState: "running",
    transportRef: { tmuxSession: "tmux-b" },
  });

  await registerAgentSessionRoutes(app, {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {} as never,
    localTmuxInputRouter: {} as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {} as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {} as never,
    codexSessionLocator: {
      async resolve({ tmuxTarget }) {
        return tmuxTarget === "tmux-a" ? "codex-session-a" : "codex-session-b";
      },
    },
    codexTranscriptService: {
      read(input) {
        return {
          available: true,
          agentKind: "codex",
          sessionId: input.sessionId ?? null,
          matchedBy: "session-id",
          updatedAt: "2026-08-19T00:00:00.000Z",
          entries: [],
          hasMore: false,
          nextCursor: null,
        };
      },
    },
  });

  const [firstResponse, secondResponse] = await Promise.all([
    app.inject({
      method: "GET",
      url: `/api/agent-sessions/${first.id}/transcript`,
    }),
    app.inject({
      method: "GET",
      url: `/api/agent-sessions/${second.id}/transcript`,
    }),
  ]);

  assert.equal(
    (firstResponse.json() as AgentTranscriptResponse).sessionId,
    "codex-session-a",
  );
  assert.equal(
    (secondResponse.json() as AgentTranscriptResponse).sessionId,
    "codex-session-b",
  );
  assert.equal(registry.get(first.id).agentSessionId, "codex-session-a");
  assert.equal(registry.get(second.id).agentSessionId, "codex-session-b");
  await app.close();
});

test("GET task changes maps a local tmux node card to its active Codex diff", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "node",
    displayName: "tmux codex",
    workingDirectory: "/workspace/shared",
    connectionState: "online",
    interactionState: "running",
    transportRef: { tmuxSession: "tmux-codex" },
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
    codexSessionLocator: {
      async resolve() {
        return "active-codex-session";
      },
    },
    codexChangeService: {
      read(input) {
        receivedInput = input;
        return {
          available: true,
          scope: "task",
          agentKind: "codex",
          sessionId: input.sessionId ?? null,
          matchedBy: "session-id",
          confidence: "medium",
          changedFiles: 1,
          addedLines: 1,
          deletedLines: 1,
          files: [],
          generatedAt: "2026-08-19T00:00:00.000Z",
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/task-changes`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.json() as AgentTaskDiffResponse).available, true);
  assert.deepEqual(receivedInput, {
    sessionId: "active-codex-session",
    workingDirectory: "/workspace/shared",
  });
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

test("GET task summary extracts the latest structured Codex messages", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "codex pane",
    workingDirectory: "/workspace/project",
    interactionState: "idle",
  });

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
        return {
          available: true,
          agentKind: "codex",
          sessionId: "codex-session-id",
          matchedBy: "working-directory",
          updatedAt: "2026-08-13T02:00:00.000Z",
          hasMore: false,
          nextCursor: null,
          entries: [
            {
              id: "user-1",
              timestamp: "",
              kind: "user",
              title: "你",
              text: "实现卡片摘要",
              collapsedByDefault: false,
            },
            {
              id: "assistant-1",
              timestamp: "",
              kind: "assistant",
              title: "Codex",
              text: "已完成实现并通过测试",
              collapsedByDefault: false,
            },
          ],
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/task-summary`,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json() as AgentTaskSummaryResponse, {
    available: true,
    lastUserMessageSummary: "实现卡片摘要",
    lastAgentMessageSummary: "已完成实现并通过测试",
    updatedAt: "2026-08-13T02:00:00.000Z",
  });
  assert.equal(
    registry.get(session.id).lastAgentMessageSummary,
    "已完成实现并通过测试",
  );
  await app.close();
});

test("GET task summary reuses the cached transcript within the refresh window", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "cached codex pane",
    workingDirectory: "/workspace/project",
    interactionState: "running",
  });
  let readCount = 0;

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
        readCount += 1;
        return {
          available: true,
          agentKind: "codex",
          sessionId: "codex-session-id",
          matchedBy: "working-directory",
          updatedAt: "2026-08-13T02:00:00.000Z",
          entries: [],
          hasMore: false,
          nextCursor: null,
        };
      },
    },
  });

  const [first, second] = await Promise.all([
    app.inject({
      method: "GET",
      url: `/api/agent-sessions/${session.id}/task-summary`,
    }),
    app.inject({
      method: "GET",
      url: `/api/agent-sessions/${session.id}/task-summary`,
    }),
  ]);
  const third = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/task-summary`,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 200);
  assert.equal(readCount, 1);
  await app.close();
});

test("GET task summary supports local tmux sessions even when agentKind is shell", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    sourceType: "local",
    agentKind: "shell",
    displayName: "local tmux",
    workingDirectory: "/workspace/project",
    interactionState: "idle",
    transportRef: { tmuxSession: "kanban-summary" },
  });

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
        return {
          available: true,
          agentKind: "codex",
          sessionId: "codex-session-id",
          matchedBy: "working-directory",
          updatedAt: "2026-08-13T02:00:00.000Z",
          hasMore: false,
          nextCursor: null,
          entries: [
            {
              id: "user-1",
              timestamp: "",
              kind: "user",
              title: "你",
              text: "处理 tmux 任务",
              collapsedByDefault: false,
            },
          ],
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/agent-sessions/${session.id}/task-summary`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal((response.json() as AgentTaskSummaryResponse).available, true);
  assert.equal(
    registry.get(session.id).lastUserMessageSummary,
    "处理 tmux 任务",
  );
  await app.close();
});

test("Codex JSONL routes ignore explicit OpenCode tmux sessions", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "opencode",
    displayName: "OpenCode tmux",
    workingDirectory: "/workspace/shared",
    connectionState: "online",
    interactionState: "running",
    transportRef: { tmuxSession: "tmux-opencode" },
  });
  let locatorCalled = false;
  let transcriptReadCalled = false;
  let changesReadCalled = false;

  await registerAgentSessionRoutes(app, {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {} as never,
    localTmuxInputRouter: {} as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {} as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {} as never,
    codexSessionLocator: {
      async resolve() {
        locatorCalled = true;
        return "wrong-codex-session";
      },
    },
    codexTranscriptService: {
      read() {
        transcriptReadCalled = true;
        return {
          available: true,
          agentKind: "codex",
          sessionId: "wrong-codex-session",
          matchedBy: "working-directory",
          updatedAt: "2026-08-20T00:00:00.000Z",
          entries: [],
          hasMore: false,
          nextCursor: null,
        };
      },
    },
    codexChangeService: {
      read() {
        changesReadCalled = true;
        return {
          available: true,
          scope: "task",
          agentKind: "codex",
          sessionId: "wrong-codex-session",
          matchedBy: "working-directory",
          confidence: "medium",
          changedFiles: 0,
          addedLines: 0,
          deletedLines: 0,
          files: [],
          generatedAt: "2026-08-20T00:00:00.000Z",
        };
      },
    },
  });

  const [summaryResponse, changesResponse, transcriptResponse] =
    await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/agent-sessions/${session.id}/task-summary`,
      }),
      app.inject({
        method: "GET",
        url: `/api/agent-sessions/${session.id}/task-changes`,
      }),
      app.inject({
        method: "GET",
        url: `/api/agent-sessions/${session.id}/transcript`,
      }),
    ]);

  assert.equal(
    (summaryResponse.json() as AgentTaskSummaryResponse).available,
    false,
  );
  assert.equal(
    (changesResponse.json() as AgentTaskDiffResponse).available,
    false,
  );
  assert.equal(
    (transcriptResponse.json() as AgentTranscriptResponse).available,
    false,
  );
  assert.equal(locatorCalled, false);
  assert.equal(transcriptReadCalled, false);
  assert.equal(changesReadCalled, false);
  assert.equal(registry.get(session.id).agentSessionId, undefined);
  await app.close();
});
