import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { FeishuNotificationSettingsResponse } from "@agent-orchestrator/shared";

import { FeishuReplyEventListener } from "./feishu-reply-event-listener.js";

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

test("starts the bot event consumer only when reply control is enabled and waits for ready", async () => {
  let settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: false,
  };
  let settingsListener:
    | ((next: FeishuNotificationSettingsResponse) => void)
    | null = null;
  const child = new FakeChildProcess();
  const spawnCalls: Array<{ binary: string; args: string[] }> = [];
  const handled: unknown[] = [];
  const listener = new FeishuReplyEventListener({
    settings: {
      get: () => settings,
      subscribe: (next) => {
        settingsListener = next;
        return () => {
          settingsListener = null;
        };
      },
    },
    spawnProcess: (binary, args) => {
      spawnCalls.push({ binary, args });
      return child;
    },
    handleEvent: async (event) => {
      handled.push(event);
    },
  });
  const stop = listener.start();

  try {
    assert.equal(spawnCalls.length, 0);
    settings = { ...settings, replyEnabled: true };
    (
      settingsListener as
        | ((next: FeishuNotificationSettingsResponse) => void)
        | null
    )?.(settings);
    assert.deepEqual(spawnCalls, [
      {
        binary: "lark-cli",
        args: ["event", "consume", "im.message.receive_v1", "--as", "bot"],
      },
    ]);

    child.stdout.write(
      `${JSON.stringify({ type: "im.message.receive_v1", message_id: "om_reply" })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(handled.length, 0);

    child.stderr.write("[event] ready event_key=im.message.receive_v1\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(handled, [
      { type: "im.message.receive_v1", message_id: "om_reply" },
    ]);

    settings = { ...settings, replyEnabled: false };
    (
      settingsListener as
        | ((next: FeishuNotificationSettingsResponse) => void)
        | null
    )?.(settings);
    assert.equal(child.stdin.writableEnded, true);
  } finally {
    stop();
  }
});
