import { test } from "node:test";
import assert from "node:assert/strict";
import { botAutomationRunner } from "./bot-runner.js";
test("unattended bot runner propagates cancellation and treats denied work as failure", async () => {
  const controller = new AbortController();
  let received: unknown[] = [];
  const runner = botAutomationRunner({
    runBotUnattended: async (...args) => {
      received = args;
      return {
        sessionId: "s",
        historySessionId: "history-s",
        reply: "denied",
        blocked: true,
      };
    },
  });
  await assert.rejects(
    runner({
      taskId: "task",
      taskName: "Task",
      prompt: "work",
      model: "model",
      modelProvider: "provider",
      botId: "bot",
      onStarted: () => {},
      signal: controller.signal,
    }),
    /blocked/,
  );
  assert.equal(received[3], true);
  assert.equal(received[5], controller.signal);
});
