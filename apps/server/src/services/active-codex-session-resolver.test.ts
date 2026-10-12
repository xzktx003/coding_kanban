import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  resolveActiveCodexSessionId,
  resolveCodexSessionIds,
  verifyBoundCodexQueueThread,
} from "./active-codex-session-resolver.js";

function makeSession(): AgentSessionRecord {
  return {
    id: "kanban-session",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "shell",
    displayName: "split tmux",
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    transportRef: { tmuxSession: "split", tmuxPane: "%1" },
  };
}

test("resolveCodexSessionIds returns every thread in a local tmux session", async () => {
  const updated: unknown[] = [];
  const result = await resolveCodexSessionIds(makeSession(), {
    registry: {
      updateSession: (...args) => {
        updated.push(args);
        return makeSession();
      },
    },
    codexSessionLocator: {
      resolve: async () => "active-thread",
      resolveTmuxPanes: async () => [
        { paneId: "%1", sessionId: "thread-one" },
        { paneId: "%2", sessionId: "thread-two" },
      ],
    },
  });

  assert.deepEqual(result, ["thread-one", "thread-two"]);
  assert.deepEqual(updated, []);
});

test("resolveCodexSessionIds falls back to the active thread when pane enumeration is unavailable", async () => {
  const result = await resolveCodexSessionIds(makeSession(), {
    registry: {
      updateSession: (_sessionId, patch) => ({
        ...makeSession(),
        ...patch,
      }),
    },
    codexSessionLocator: {
      resolve: async () => "active-thread",
      resolveTmuxPanes: async () => [],
    },
  });

  assert.deepEqual(result, ["active-thread"]);
});

test("history-only resolution cannot replace the registered input target", async () => {
  const updates: unknown[] = [];
  const session = { ...makeSession(), agentSessionId: "registered-thread" };
  const dependencies = {
    registry: {
      updateSession: (...args: unknown[]) => {
        updates.push(args);
        return session;
      },
    },
    codexSessionLocator: {
      resolve: async (input: { historySessionId?: string }) =>
        input.historySessionId ? "registered-thread" : undefined,
    },
  };
  assert.equal(
    await resolveActiveCodexSessionId(session, dependencies, {
      historyOnly: true,
    }),
    "registered-thread",
  );
  assert.deepEqual(updates, []);
  assert.equal(
    await resolveActiveCodexSessionId(session, dependencies),
    undefined,
  );
});

test("history reads do not mutate registered IDs even with a precise live match", async () => {
  const session = { ...makeSession(), agentSessionId: "registered-thread" };
  const updates: unknown[] = [];
  const dependencies = {
    registry: {
      updateSession: (...args: unknown[]) => {
        updates.push(args);
        return session;
      },
    },
    codexSessionLocator: { resolve: async () => "live-thread" },
  };
  assert.equal(
    await resolveActiveCodexSessionId(session, dependencies, {
      historyOnly: true,
    }),
    "live-thread",
  );
  assert.deepEqual(updates, []);
  assert.equal(
    await resolveActiveCodexSessionId(session, dependencies),
    "live-thread",
  );
  assert.equal(updates.length, 1);
});

test("bound card queue checks only its exact local live thread without changing input routing", async () => {
  const calls: unknown[] = [];
  const updates: unknown[] = [];
  const session = makeSession();
  const dependencies = {
    registry: {
      updateSession: (...args: unknown[]) => {
        updates.push(args);
        return session;
      },
    },
    codexSessionLocator: {
      resolve: async () => undefined,
      resolveTmuxPanes: async (
        tmuxSession: string,
        options?: { readOnlyCompletion?: boolean },
      ) => {
        calls.push([tmuxSession, options]);
        return options?.readOnlyCompletion
          ? [{ paneId: "%1", sessionId: "startup-thread" }]
          : [];
      },
    },
  };

  assert.deepEqual(await resolveCodexSessionIds(session, dependencies), []);
  assert.equal(
    await verifyBoundCodexQueueThread(session, "startup-thread", dependencies),
    true,
  );
  assert.equal(
    await verifyBoundCodexQueueThread(session, "old-thread", dependencies),
    false,
  );
  assert.deepEqual(updates, []);
  assert.deepEqual(calls, [
    ["split", undefined],
    ["split", { readOnlyCompletion: true }],
    ["split", { readOnlyCompletion: true }],
  ]);
  assert.equal(
    await verifyBoundCodexQueueThread(
      { ...session, hostId: "remote" },
      "startup-thread",
      dependencies,
    ),
    false,
  );
  assert.equal(
    await verifyBoundCodexQueueThread(
      { ...session, transportRef: undefined },
      "startup-thread",
      dependencies,
    ),
    false,
  );
  assert.equal(calls.length, 3);
});
