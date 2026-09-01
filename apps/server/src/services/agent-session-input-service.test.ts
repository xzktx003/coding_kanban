import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { AgentSessionInputService } from "./agent-session-input-service.js";

function makeSession(
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Codex",
    connectionState: "online",
    interactionState: "idle",
    controlMode: "control",
    transportRef: { tmuxSession: "codex-session", tmuxPane: "%1" },
    ...overrides,
  };
}

test("routes Feishu-compatible prompt bytes through the existing local tmux input queue", async () => {
  const session = makeSession();
  const writes: Array<{ id: string; input: string }> = [];
  const service = new AgentSessionInputService({
    registry: { get: () => session },
    tmuxAdapter: {
      writeInput: async () => {
        throw new Error("unexpected direct tmux adapter write");
      },
    },
    localTmuxInputRouter: {
      write: async (target, body) => {
        writes.push({ id: target.id, input: body.input });
        return target;
      },
    },
    sshRuntimeManager: {
      writeInput: () => {
        throw new Error("unexpected SSH write");
      },
    },
    ptyRuntimeManager: {
      has: () => false,
      write: async () => {
        throw new Error("unexpected PTY write");
      },
    },
    processRuntimeManager: {
      writeInput: () => {
        throw new Error("unexpected process write");
      },
    },
  });

  const input = "\x1b[200~请继续检查\n并运行测试\x1b[201~\r";
  const result = await service.write(session.id, input);

  assert.equal(result, session);
  assert.deepEqual(writes, [{ id: session.id, input }]);
});

test("keeps SSH runtime input on the existing remote connection", async () => {
  const session = makeSession({
    sourceType: "remote-connect",
    sshTarget: { host: "build-host", port: 22 },
    transportRef: { runtimeId: "ssh:session-1" },
  });
  const writes: Array<{ id: string; input: string }> = [];
  const service = new AgentSessionInputService({
    registry: { get: () => session },
    tmuxAdapter: {
      writeInput: async () => {
        throw new Error("unexpected tmux write");
      },
    },
    localTmuxInputRouter: {
      write: async () => {
        throw new Error("unexpected local tmux write");
      },
    },
    sshRuntimeManager: {
      writeInput: (id, body) => {
        writes.push({ id, input: body.input });
        return session;
      },
    },
    ptyRuntimeManager: {
      has: () => false,
      write: async () => {
        throw new Error("unexpected PTY write");
      },
    },
    processRuntimeManager: {
      writeInput: () => {
        throw new Error("unexpected process write");
      },
    },
  });

  const result = await service.write(session.id, "继续执行\r");

  assert.equal(result, session);
  assert.deepEqual(writes, [{ id: session.id, input: "继续执行\r" }]);
});
