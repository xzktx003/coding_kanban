import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionStreamEvent } from "@agent-orchestrator/shared";

import { buildServer } from "../app.js";

test("agent session websocket sends one snapshot followed by compact deltas", async () => {
  const { app, registry } = buildServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");

  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/ws/agent-sessions`,
  );

  try {
    const events = await new Promise<AgentSessionStreamEvent[]>(
      (resolve, reject) => {
        const received: AgentSessionStreamEvent[] = [];
        const timeoutId = setTimeout(
          () => reject(new Error("agent session stream timed out")),
          3_000,
        );
        socket.addEventListener("message", async (message) => {
          const text =
            typeof message.data === "string"
              ? message.data
              : await message.data.text();
          received.push(JSON.parse(text) as AgentSessionStreamEvent);
          if (received.length === 1) {
            registry.register({
              workspaceId: "default",
              sourceType: "local",
              agentKind: "codex",
              displayName: "Only changed session",
              workingDirectory: "/workspace",
            });
          } else {
            clearTimeout(timeoutId);
            resolve(received);
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timeoutId);
          reject(new Error("agent session websocket failed"));
        });
      },
    );

    assert.equal(events[0]?.type, "snapshot");
    assert.equal(events[1]?.type, "delta");
    if (events[1]?.type === "delta") {
      assert.equal(events[1].payload.upserts.length, 1);
      assert.deepEqual(events[1].payload.removedIds, []);
    }
  } finally {
    socket.close();
    await app.close();
  }
});
