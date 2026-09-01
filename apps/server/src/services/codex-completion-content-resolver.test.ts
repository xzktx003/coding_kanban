import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { CodexCompletionContentResolver } from "./codex-completion-content-resolver.js";

function makeShellSession(): AgentSessionRecord {
  return {
    id: "kanban-session-1",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "shell",
    displayName: "project-shell",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "idle",
    transportRef: {
      tmuxSession: "project-shell",
      tmuxPane: "%12",
      processId: 4321,
    },
  };
}

test("resolves the complete last assistant entry from the active tmux Codex conversation", async () => {
  const session = makeShellSession();
  const readInputs: unknown[] = [];
  const completionInputs: unknown[] = [];
  const completeOutput = `最终说明\n\n${"保留完整正文".repeat(150)}`;
  const resolver = new CodexCompletionContentResolver({
    registry: {
      get: () => session,
      updateSession: () => session,
    },
    codexSessionLocator: {
      resolve: async () => "codex-session-12345678",
    },
    codexTranscriptService: {
      read: (input) => {
        readInputs.push(input);
        return {
          available: true,
          agentKind: "codex",
          sessionId: "codex-session-12345678",
          matchedBy: "session-id",
          updatedAt: "2026-09-01T11:30:00.000Z",
          entries: [
            {
              id: "assistant-1",
              timestamp: "2026-09-01T11:30:00.000Z",
              kind: "assistant",
              title: "Codex",
              text: completeOutput,
              collapsedByDefault: false,
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      },
      readLatestCompletion: (input) => {
        completionInputs.push(input);
        return {
          completionId: "turn-local",
          content: completeOutput,
          completedAt: "2026-09-01T11:30:00.000Z",
        };
      },
    },
  });

  assert.equal(
    await resolver.resolve({
      sessionId: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      workingDirectory: session.workingDirectory,
      summary: "截断摘要",
      completedAt: "2026-09-01T11:30:00.000Z",
    }),
    completeOutput,
  );
  assert.deepEqual(readInputs, [
    {
      sessionId: "codex-session-12345678",
      workingDirectory: "/workspace/project",
      limit: 30,
    },
  ]);
  assert.deepEqual(
    await resolver.inspectLatestCompletion({
      sessionId: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      workingDirectory: session.workingDirectory,
      summary: "截断摘要",
      completedAt: "2026-09-01T11:30:00.000Z",
    }),
    {
      completionId: "turn-local",
      content: completeOutput,
      completedAt: "2026-09-01T11:30:00.000Z",
    },
  );
  assert.deepEqual(completionInputs, [
    {
      sessionId: "codex-session-12345678",
      workingDirectory: "/workspace/project",
    },
  ]);
});

test("does not read a Codex transcript for an explicit non-Codex agent", async () => {
  const session = { ...makeShellSession(), agentKind: "claude" };
  let reads = 0;
  const resolver = new CodexCompletionContentResolver({
    registry: {
      get: () => session,
      updateSession: () => session,
    },
    codexSessionLocator: { resolve: async () => undefined },
    codexTranscriptService: {
      read: () => {
        reads += 1;
        throw new Error("should not read");
      },
    },
  });

  assert.equal(
    await resolver.resolve({
      sessionId: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      summary: "Claude 完成",
      completedAt: "2026-09-01T11:30:00.000Z",
    }),
    null,
  );
  assert.equal(reads, 0);
});

test("reads the complete last assistant entry from a registered SSH Codex session", async () => {
  const session: AgentSessionRecord = {
    ...makeShellSession(),
    sourceType: "remote-connect",
    agentKind: "codex",
    agentSessionId: "remote-codex-session-12345678",
    sshTarget: {
      host: "gpu.example.test",
      port: 22,
      username: "developer",
    },
  };
  const remoteInputs: unknown[] = [];
  const remoteCompletionInputs: unknown[] = [];
  const resolver = new CodexCompletionContentResolver({
    registry: {
      get: () => session,
      updateSession: () => session,
    },
    codexSessionLocator: { resolve: async () => undefined },
    codexTranscriptService: {
      read: () => {
        throw new Error("local transcript should not be read");
      },
      readRemote: async (input) => {
        remoteInputs.push(input);
        return {
          available: true,
          agentKind: "codex",
          sessionId: "remote-codex-session-12345678",
          matchedBy: "session-id",
          updatedAt: "2026-09-01T11:35:00.000Z",
          entries: [
            {
              id: "assistant-remote",
              timestamp: "2026-09-01T11:35:00.000Z",
              kind: "assistant",
              title: "Codex",
              text: "远端完整最终输出",
              collapsedByDefault: false,
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      },
      readLatestRemoteCompletion: async (input) => {
        remoteCompletionInputs.push(input);
        return {
          completionId: "turn-remote",
          content: "远端完整最终输出",
          completedAt: "2026-09-01T11:35:00.000Z",
        };
      },
    },
  });

  assert.equal(
    await resolver.resolve({
      sessionId: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      workingDirectory: session.workingDirectory,
      summary: "远端摘要",
      completedAt: "2026-09-01T11:35:00.000Z",
    }),
    "远端完整最终输出",
  );
  assert.deepEqual(remoteInputs, [
    {
      sshTarget: session.sshTarget,
      sessionId: "remote-codex-session-12345678",
      workingDirectory: "/workspace/project",
      limit: 30,
    },
  ]);
  assert.deepEqual(
    await resolver.inspectLatestCompletion({
      sessionId: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      workingDirectory: session.workingDirectory,
      summary: "远端摘要",
      completedAt: "2026-09-01T11:35:00.000Z",
    }),
    {
      completionId: "turn-remote",
      content: "远端完整最终输出",
      completedAt: "2026-09-01T11:35:00.000Z",
    },
  );
  assert.deepEqual(remoteCompletionInputs, [
    {
      sshTarget: session.sshTarget,
      sessionId: "remote-codex-session-12345678",
      workingDirectory: "/workspace/project",
    },
  ]);
});
