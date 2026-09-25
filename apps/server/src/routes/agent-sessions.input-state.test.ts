import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("remote reconnect still attaches when tmux lacks terminal-features", async () => {
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "remote",
    sourceType: "remote-connect",
    agentKind: "node",
    displayName: "24_hermes",
    sshTarget: { host: "remote.example.test", username: "developer" },
    transportRef: { tmuxSession: "24_hermes", tmuxPane: "%0" },
  });
  let remoteCommand = "";
  await reconnectRegisteredAgentSession(session.id, {
    registry,
    tmuxAdapter: { getCaptureLines: () => 5_000 },
    localTmuxInputRouter: { clear: async () => {} },
    ptyRuntimeManager: {
      reconnectLocal: () => {
        throw new Error("unexpected local reconnect");
      },
      reconnectRemote: (_id, input) => {
        remoteCommand = input.remoteCommand;
        return registry.get(session.id);
      },
    },
  });

  const directory = mkdtempSync(join(tmpdir(), "kanban-old-tmux-"));
  try {
    const fakeTmux = join(directory, "tmux");
    const callLog = join(directory, "calls.log");
    writeFileSync(
      fakeTmux,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TMUX_CALL_LOG"\ncase "$*" in *terminal-features*) exit 1;; esac\n',
    );
    chmodSync(fakeTmux, 0o755);
    const result = spawnSync("sh", ["-c", remoteCommand], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        TMUX_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(callLog, "utf8"), /attach -t 24_hermes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, "");

    const snapshot = registry.list();
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

test("PATCH API marks a completed session unread and read", async () => {
  const events: string[] = [];
  const { app, registry } = await buildRouteApp(events);
  const session = registerLocalTmuxSession(registry);
  registry.updateSession(session.id, { interactionState: "idle" });
  registry.focus({ agentSessionId: session.id });

  try {
    const unreadResponse = await app.inject({
      method: "PATCH",
      url: `/api/agent-sessions/${session.id}`,
      payload: { hasUnreadCompletion: true },
    });
    assert.equal(unreadResponse.statusCode, 200);
    assert.equal(unreadResponse.json().hasUnreadCompletion, true);

    const readResponse = await app.inject({
      method: "PATCH",
      url: `/api/agent-sessions/${session.id}`,
      payload: { hasUnreadCompletion: false },
    });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().hasUnreadCompletion, false);
  } finally {
    await app.close();
  }
});

test("PATCH API rejects marking a running session unread", async () => {
  const events: string[] = [];
  const { app, registry } = await buildRouteApp(events);
  const session = registerLocalTmuxSession(registry);

  try {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/agent-sessions/${session.id}`,
      payload: { hasUnreadCompletion: true },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(registry.get(session.id).hasUnreadCompletion, undefined);
  } finally {
    await app.close();
  }
});
