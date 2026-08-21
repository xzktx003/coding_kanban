import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../app.js";

async function waitForReplayFrame(
  terminalUrl: string,
  timeoutMs = 3_000,
): Promise<{ event: string; data?: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(terminalUrl);
    const timeoutId = setTimeout(() => {
      socket.close();
      reject(new Error("terminal websocket did not emit a replay frame"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.close();
    };

    socket.addEventListener("message", async (event) => {
      const payload =
        typeof event.data === "string" ? event.data : await event.data.text();
      const parsed = JSON.parse(payload) as {
        __agentOrchestrator?: string;
        event?: string;
        data?: string;
      };

      if (parsed.__agentOrchestrator !== "terminal-control") {
        return;
      }

      if (parsed.event !== "replay") {
        return;
      }

      cleanup();
      resolve({ event: parsed.event, data: parsed.data });
    });

    socket.addEventListener("close", (event) => {
      clearTimeout(timeoutId);
      reject(
        new Error(
          `terminal websocket closed before replay: ${event.code} ${event.reason}`,
        ),
      );
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("terminal websocket connection failed"));
    });
  });
}

async function waitForExitedSession(
  baseUrl: string,
  agentSessionId: string,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const detailResponse = await fetch(
      `${baseUrl}/api/agent-sessions/${agentSessionId}`,
    );
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      agentSession: { interactionState: string };
    };

    if (detail.agentSession.interactionState === "exited") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("agent session did not exit in time");
}

test("terminal websocket replay strips CPR queries before sending scrollback to new clients", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const launchResponse = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: `terminal-replay-${Date.now()}`,
        agentKind: "shell",
        command: "printf 'cpr-burst-start\\n'; printf '\\033[6n'; sleep 5",
        workingDirectory: process.cwd(),
      }),
    });

    assert.equal(launchResponse.status, 201);

    const payload = (await launchResponse.json()) as { id: string };
    agentSessionId = payload.id;

    await new Promise((resolve) => setTimeout(resolve, 350));

    const replayFrame = await waitForReplayFrame(
      `${terminalUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );

    assert.equal(replayFrame.event, "replay");
    assert.match(replayFrame.data ?? "", /cpr-burst-start/);
    assert.doesNotMatch(replayFrame.data ?? "", /\[6n|\[6n/);
  } finally {
    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});

test("terminal websocket replays exited session output instead of closing before replay", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const launchResponse = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: `terminal-exit-replay-${Date.now()}`,
        agentKind: "shell",
        command: "printf 'before-exit\\n'; exit 1",
        workingDirectory: process.cwd(),
      }),
    });

    assert.equal(launchResponse.status, 201);

    const payload = (await launchResponse.json()) as { id: string };
    agentSessionId = payload.id;

    await waitForExitedSession(baseUrl, agentSessionId);

    const replayFrame = await waitForReplayFrame(
      `${terminalUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );

    assert.equal(replayFrame.event, "replay");
    assert.match(replayFrame.data ?? "", /before-exit/);
    assert.match(replayFrame.data ?? "", /Process exited with code 1/);
  } finally {
    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});

test("terminal websocket honors a bounded mobile replay window", async () => {
  const { app, registry } = buildServer();
  const session = registry.register({
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "bounded mobile replay",
    workingDirectory: process.cwd(),
  });
  registry.appendOutput(
    session.id,
    `${"旧".repeat(2_000)}-newest-tail`,
    "stdout",
  );

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");

  try {
    const replayFrame = await waitForReplayFrame(
      `ws://127.0.0.1:${address.port}/ws/agent-sessions/${session.id}/terminal?replayBytes=1024`,
    );
    assert.match(replayFrame.data ?? "", /-newest-tail$/);
    assert.ok(Buffer.byteLength(replayFrame.data ?? "", "utf8") <= 1024);
    assert.doesNotMatch(replayFrame.data ?? "", /�/);
  } finally {
    await app.close();
  }
});
