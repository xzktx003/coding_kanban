import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../app.js";
import type { FeishuCompletionObservation } from "../services/agent-completion-feishu-notifier.js";

test("agent session websocket broadcasts one structured completion chime", async () => {
  let current: FeishuCompletionObservation = {
    completionId: "baseline",
    content: "already finished",
    completedAt: "2026-11-04T09:00:00.000Z",
  };
  let inspections = 0;
  let markBaseline: () => void = () => {};
  const baselineInspected = new Promise<void>((resolve) => {
    markBaseline = resolve;
  });
  const { app, registry } = buildServer({
    feishuCompletionSender: { send: async () => {} },
    feishuCompletionContentResolver: {
      resolve: async () => current.content,
      inspectLatestCompletions: async () => {
        inspections += 1;
        if (inspections === 1) markBaseline();
        return [current];
      },
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/ws/agent-sessions`,
  );
  const messages: Array<Record<string, unknown>> = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error("agent session snapshot timed out")),
        3_000,
      );
      socket.addEventListener("message", async (message) => {
        const text =
          typeof message.data === "string"
            ? message.data
            : await message.data.text();
        messages.push(JSON.parse(text) as Record<string, unknown>);
        if (messages.some((item) => item.type === "snapshot")) {
          clearTimeout(timeoutId);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeoutId);
        reject(new Error("agent session websocket failed"));
      });
    });

    const session = registry.register({
      workspaceId: "default",
      sourceType: "local",
      agentKind: "codex",
      displayName: "Codex task",
      workingDirectory: "/workspace",
      interactionState: "running",
      outputPreview: "working",
    });
    await baselineInspected;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      messages.filter((item) => item.type === "completion-chime").length,
      0,
    );

    current = {
      completionId: "turn-1",
      content: "done",
      completedAt: "2026-11-04T10:00:01.000Z",
    };
    registry.updateSession(session.id, {
      lastOutputAt: "2026-11-04T10:00:01.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error("completion chime timed out")),
        3_000,
      );
      const check = () => {
        if (
          messages.filter((item) => item.type === "completion-chime").length ===
          1
        ) {
          clearTimeout(timeoutId);
          resolve();
        }
      };
      check();
      socket.addEventListener("message", () => check());
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const chimes = messages.filter((item) => item.type === "completion-chime");
    assert.equal(chimes.length, 1);
    assert.deepEqual(chimes[0]?.payload, {
      sessionId: session.id,
      completionId: "turn-1",
      agentKind: "codex",
    });
    assert.equal(messages.some((item) => item.type === "snapshot"), true);
  } finally {
    socket.close();
    await app.close();
  }
});
