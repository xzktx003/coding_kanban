import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  createSingleFlightManagedSessionRestorer,
  restoreManagedSessions,
} from "./managed-session-restorer.js";

function session(id: string, tmuxSession?: string): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "shell",
    displayName: id,
    connectionState: "offline",
    interactionState: tmuxSession ? "detached" : "exited",
    transportRef: tmuxSession ? { tmuxSession } : undefined,
  };
}

test("restores existing managed tmux sessions and classifies all other outcomes", async () => {
  const sessions = [
    session("restored", "tmux-restored"),
    session("connected", "tmux-connected"),
    session("missing", "tmux-missing"),
    session("direct"),
  ];
  const reconnected: string[] = [];

  const result = await restoreManagedSessions({
    sessions,
    isConnected: (id) => id === "connected",
    resolveTmuxTarget: async (candidate) =>
      candidate.id === "missing"
        ? null
        : {
            tmuxSession: candidate.transportRef!.tmuxSession!,
            tmuxPane: `%${candidate.id}`,
          },
    clearInputState: () => {},
    reconnect: async (candidate, target) => {
      reconnected.push(`${candidate.id}:${target.tmuxPane}`);
    },
  });

  assert.deepEqual(result.restoredIds, ["restored"]);
  assert.deepEqual(result.alreadyConnectedIds, ["connected"]);
  assert.deepEqual(result.manualRecoveryIds, ["direct"]);
  assert.deepEqual(result.failed, [
    {
      agentSessionId: "missing",
      displayName: "missing",
      error: "tmux 会话不存在或当前不可访问",
    },
  ]);
  assert.deepEqual(reconnected, ["restored:%restored"]);
});

test("reports reconnect failures without aborting the remaining restore queue", async () => {
  const result = await restoreManagedSessions({
    sessions: [
      session("broken", "tmux-broken"),
      session("healthy", "tmux-healthy"),
    ],
    isConnected: () => false,
    resolveTmuxTarget: async (candidate) => ({
      tmuxSession: candidate.transportRef!.tmuxSession!,
    }),
    clearInputState: () => {},
    reconnect: async (candidate) => {
      if (candidate.id === "broken") {
        throw new Error("attach failed");
      }
    },
  });

  assert.deepEqual(result.restoredIds, ["healthy"]);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]?.error ?? "", /attach failed/);
});

test("clears per-session input state before rebuilding a managed tmux connection", async () => {
  const events: string[] = [];
  let releaseCleanup: (() => void) | undefined;
  let markCleanupStarted: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });

  const restore = restoreManagedSessions({
    sessions: [session("managed", "tmux-managed")],
    isConnected: () => false,
    resolveTmuxTarget: async () => ({
      tmuxSession: "tmux-managed",
      tmuxPane: "%managed",
    }),
    clearInputState: async (agentSessionId) => {
      events.push(`clear:${agentSessionId}`);
      markCleanupStarted?.();
      await cleanupGate;
      events.push(`cleared:${agentSessionId}`);
    },
    reconnect: async (candidate) => {
      events.push(`reconnect:${candidate.id}`);
    },
  });

  await cleanupStarted;
  assert.deepEqual(events, ["clear:managed"]);
  releaseCleanup?.();
  const result = await restore;

  assert.deepEqual(result.restoredIds, ["managed"]);
  assert.deepEqual(events, [
    "clear:managed",
    "cleared:managed",
    "reconnect:managed",
  ]);
});

test("coalesces concurrent managed restore requests and allows a later retry", async () => {
  let restoreCalls = 0;
  let releaseFirstRestore: (() => void) | undefined;
  const firstRestoreGate = new Promise<void>((resolve) => {
    releaseFirstRestore = resolve;
  });
  const response = {
    restoredIds: ["managed"],
    alreadyConnectedIds: [],
    manualRecoveryIds: [],
    failed: [],
  };
  const restorer = createSingleFlightManagedSessionRestorer(async () => {
    restoreCalls += 1;
    if (restoreCalls === 1) {
      await firstRestoreGate;
    }
    return response;
  });

  const first = restorer.restore();
  const second = restorer.restore();

  assert.equal(restoreCalls, 1);
  releaseFirstRestore?.();
  assert.deepEqual(await first, response);
  assert.deepEqual(await second, response);

  assert.deepEqual(await restorer.restore(), response);
  assert.equal(restoreCalls, 2);
});
