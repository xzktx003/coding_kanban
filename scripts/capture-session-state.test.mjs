import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureSessionState,
  isAgentSessionSnapshot,
  SESSION_CAPTURE_TIMEOUT_MS,
} from "./capture-session-state.mjs";

const snapshot = {
  items: [
    {
      id: "session-1",
      workspaceId: "default",
      hostId: "local",
      sourceType: "local",
      agentKind: "shell",
      displayName: "session-1",
      connectionState: "online",
      interactionState: "running",
      stateConfidence: "medium",
      outputPreview: "secret terminal output",
      lastHeartbeatAt: "2026-07-27T00:00:00.000Z",
      transportRef: {
        processId: 12345,
        runtimeId: "pty:12345",
        tmuxSession: "session-1",
        tmuxPane: "%1",
      },
    },
  ],
  activeAgentSessionId: "session-1",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

test("allows a busy backend enough time to return the session registry", () => {
  assert.equal(SESSION_CAPTURE_TIMEOUT_MS, 15_000);
});

test("validates the minimal agent-session snapshot contract", () => {
  assert.equal(isAgentSessionSnapshot(snapshot), true);
  assert.equal(isAgentSessionSnapshot({ items: [] }), false);
  assert.equal(
    isAgentSessionSnapshot({
      ...snapshot,
      items: [{ ...snapshot.items[0], id: "" }],
    }),
    false,
  );
});

test("captures a valid snapshot atomically into the configured state path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-capture-"));
  const filePath = join(directory, "nested", "sessions.json");

  try {
    const captured = await captureSessionState({
      apiUrl: "http://127.0.0.1:4999/api/agent-sessions",
      filePath,
      fetchImpl: async () =>
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    assert.equal(captured, true);
    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(persisted, {
      items: [
        {
          id: "session-1",
          workspaceId: "default",
          hostId: "local",
          sourceType: "local",
          agentKind: "shell",
          displayName: "session-1",
          connectionState: "offline",
          interactionState: "detached",
          transportRef: {
            tmuxSession: "session-1",
            tmuxPane: "%1",
          },
        },
      ],
      activeAgentSessionId: "session-1",
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    assert.doesNotMatch(
      readFileSync(filePath, "utf8"),
      /12345|pty:|secret terminal output|lastHeartbeatAt|stateConfidence/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not replace the state file when the old backend is unavailable or invalid", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-capture-"));
  const filePath = join(directory, "sessions.json");

  try {
    assert.equal(
      await captureSessionState({
        apiUrl: "http://127.0.0.1:4999/api/agent-sessions",
        filePath,
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
      }),
      false,
    );

    assert.equal(
      await captureSessionState({
        apiUrl: "http://127.0.0.1:4999/api/agent-sessions",
        filePath,
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
