import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import {
  reconnectRegisteredAgentSession,
  registerAgentSessionRoutes,
} from "./agent-sessions.js";

function registerLocalTmuxSession(registry: AgentSessionRegistry) {
  return registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "shell",
    displayName: "tmux session",
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    transportRef: {
      tmuxSession: "session-1",
      tmuxPane: "%1",
    },
  });
}

test("manual reconnect clears local tmux input state before replacing the PTY", async () => {
  const registry = new AgentSessionRegistry();
  const session = registerLocalTmuxSession(registry);
  const events: string[] = [];
  let releaseCleanup: (() => void) | undefined;
  let markCleanupStarted: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });

  const reconnect = reconnectRegisteredAgentSession(session.id, {
    registry,
    tmuxAdapter: {
      getCaptureLines: () => 2_000,
    },
    localTmuxInputRouter: {
      clear: async (agentSessionId: string) => {
        events.push(`cleanup-start:${agentSessionId}`);
        markCleanupStarted?.();
        await cleanupGate;
        events.push(`cleanup-end:${agentSessionId}`);
      },
    },
    ptyRuntimeManager: {
      reconnectLocal: (agentSessionId: string) => {
        events.push(`reconnect-local:${agentSessionId}`);
        return registry.get(agentSessionId);
      },
      reconnectRemote: () => {
        throw new Error("unexpected remote reconnect");
      },
    },
  });

  await cleanupStarted;
  assert.deepEqual(events, [`cleanup-start:${session.id}`]);
  releaseCleanup?.();
  await reconnect;

  assert.deepEqual(events, [
    `cleanup-start:${session.id}`,
    `cleanup-end:${session.id}`,
    `reconnect-local:${session.id}`,
  ]);
});

async function buildRouteApp(events: string[]) {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  let releaseCleanup: (() => void) | undefined;
  let markCleanupStarted: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });

  await registerAgentSessionRoutes(app, {
    registry,
    processRuntimeManager: {} as never,
    tmuxAdapter: {
      clearInputState: (agentSessionId: string) => {
        events.push(`unexpected-adapter-clear:${agentSessionId}`);
      },
      killSession: async () => {
        events.push("tmux-kill");
      },
    } as never,
    localTmuxInputRouter: {
      clear: async (agentSessionId: string) => {
        events.push(`cleanup-start:${agentSessionId}`);
        markCleanupStarted?.();
        await cleanupGate;
        events.push(`cleanup-end:${agentSessionId}`);
      },
    } as never,
    sshRuntimeManager: {} as never,
    ptyRuntimeManager: {
      kill: (agentSessionId: string) => {
        events.push(`pty-kill:${agentSessionId}`);
      },
    } as never,
    remoteLaunchPreflight: {} as never,
    vsCodeWebManager: {
      stopSession: async (agentSessionId: string) => {
        events.push(`vscode-stop:${agentSessionId}`);
      },
    } as never,
  });

  await app.ready();
  return {
    app,
    registry,
    cleanupStarted,
    releaseCleanup() {
      releaseCleanup?.();
    },
  };
}

test("session delete clears local tmux input state before destroying the PTY", async () => {
  const events: string[] = [];
  const { app, registry, cleanupStarted, releaseCleanup } =
    await buildRouteApp(events);
  const session = registerLocalTmuxSession(registry);

  try {
    const response = app.inject({
      method: "DELETE",
      url: `/api/agent-sessions/${session.id}`,
    });

    await cleanupStarted;
    assert.deepEqual(events, [
      `vscode-stop:${session.id}`,
      `cleanup-start:${session.id}`,
    ]);
    releaseCleanup();
    const result = await response;

    assert.equal(result.statusCode, 204);
    assert.deepEqual(events, [
      `vscode-stop:${session.id}`,
      `cleanup-start:${session.id}`,
      `cleanup-end:${session.id}`,
      `pty-kill:${session.id}`,
    ]);
  } finally {
    await app.close();
  }
});

test("tmux kill clears local input state before killing the PTY and tmux session", async () => {
  const events: string[] = [];
  const { app, registry, cleanupStarted, releaseCleanup } =
    await buildRouteApp(events);
  const session = registerLocalTmuxSession(registry);

  try {
    const response = app.inject({
      method: "POST",
      url: `/api/agent-sessions/${session.id}/tmux/kill`,
    });

    await cleanupStarted;
    assert.deepEqual(events, [`cleanup-start:${session.id}`]);
    releaseCleanup();
    const result = await response;

    assert.equal(result.statusCode, 204);
    assert.deepEqual(events, [
      `cleanup-start:${session.id}`,
      `cleanup-end:${session.id}`,
      `pty-kill:${session.id}`,
      "tmux-kill",
    ]);
  } finally {
    await app.close();
  }
});

test("focus API acknowledges an unread completed session", async () => {
  const events: string[] = [];
  const { app, registry } = await buildRouteApp(events);
  const session = registerLocalTmuxSession(registry);
  registry.updateSession(session.id, { interactionState: "idle" });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/agent-sessions/focus",
      payload: { agentSessionId: session.id },
    });

    assert.equal(response.statusCode, 200);
    const snapshot = response.json() as {
      activeAgentSessionId: string | null;
      items: Array<{ id: string; hasUnreadCompletion?: boolean }>;
    };
    assert.equal(snapshot.activeAgentSessionId, session.id);
    assert.equal(
      snapshot.items.find((item) => item.id === session.id)
        ?.hasUnreadCompletion,
      false,
    );
  } finally {
    await app.close();
  }
});
