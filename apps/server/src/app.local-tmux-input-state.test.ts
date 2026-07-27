import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import { buildServer } from "./app.js";
import { LocalTmuxInputRouter } from "./services/local-tmux-input-router.js";

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("terminal websocket failed to open")),
      { once: true },
    );
  });

  return socket;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
    socket.close();
  });
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`timed out waiting for ${description}`);
}

test("terminal websocket closes clear only sockets that sent local tmux input", async () => {
  const writes: string[] = [];
  const clears: string[] = [];
  const originalWrite = LocalTmuxInputRouter.prototype.write;
  const originalClear = LocalTmuxInputRouter.prototype.clear;

  LocalTmuxInputRouter.prototype.write = async function (
    agentSession: AgentSessionRecord,
    input: StdinAgentSessionInput,
  ) {
    writes.push(input.input);
    return agentSession;
  };
  LocalTmuxInputRouter.prototype.clear = function (agentSessionId: string) {
    clears.push(agentSessionId);
    return Promise.resolve();
  };

  const { app, registry } = buildServer();
  const session = registry.register({
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
  let preview: WebSocket | undefined;
  let writer: WebSocket | undefined;

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const url = `ws://127.0.0.1:${address.port}/ws/agent-sessions/${session.id}/terminal`;

    preview = await openSocket(url);
    await closeSocket(preview);
    preview = undefined;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(clears, []);

    writer = await openSocket(url);
    writer.send("plain");
    await waitFor(() => writes.length === 1, "local tmux input routing");
    await closeSocket(writer);
    writer = undefined;
    await waitFor(() => clears.length === 1, "local tmux input cleanup");

    assert.deepEqual(writes, ["plain"]);
    assert.deepEqual(clears, [session.id]);
  } finally {
    preview?.close();
    writer?.close();
    await app.close();
    LocalTmuxInputRouter.prototype.write = originalWrite;
    LocalTmuxInputRouter.prototype.clear = originalClear;
  }
});
