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

test("starts an allowlisted bot menu event consumer with a matching ready marker", async () => {
  const settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: true,
  };
  const child = new FakeChildProcess();
  const spawnCalls: Array<{ binary: string; args: string[] }> = [];
  const handled: unknown[] = [];
  const listener = new FeishuReplyEventListener({
    eventKey: "application.bot.menu_v6",
    settings: { get: () => settings },
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
    assert.deepEqual(spawnCalls, [
      {
        binary: "lark-cli",
        args: ["event", "consume", "application.bot.menu_v6", "--as", "bot"],
      },
    ]);

    child.stdout.write(`${JSON.stringify({ event_key: "kanban_codex" })}\n`);
    child.stderr.write("[event] ready event_key=im.message.receive_v1\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(handled.length, 0);

    child.stderr.write("[event] ready event_key=application.bot.menu_v6\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(handled, [{ event_key: "kanban_codex" }]);
  } finally {
    stop();
  }
});

test("starts the overview menu consumer while reply control is disabled", () => {
  const settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: false,
  };
  const child = new FakeChildProcess();
  const spawnCalls: Array<{ binary: string; args: string[] }> = [];
  const listener = new FeishuReplyEventListener({
    eventKey: "application.bot.menu_v6",
    settings: { get: () => settings },
    spawnProcess: (binary, args) => {
      spawnCalls.push({ binary, args });
      return child;
    },
    handleEvent: async () => undefined,
  });
  const stop = listener.start();

  try {
    assert.deepEqual(spawnCalls, [
      {
        binary: "lark-cli",
        args: ["event", "consume", "application.bot.menu_v6", "--as", "bot"],
      },
    ]);
  } finally {
    stop();
  }
});

test("starts an allowlisted card action event consumer", () => {
  const settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: true,
  };
  const child = new FakeChildProcess();
  const spawnCalls: Array<{ binary: string; args: string[] }> = [];
  const listener = new FeishuReplyEventListener({
    eventKey: "card.action.trigger",
    settings: { get: () => settings },
    spawnProcess: (binary, args) => {
      spawnCalls.push({ binary, args });
      return child;
    },
    handleEvent: async () => undefined,
  });
  const stop = listener.start();

  try {
    assert.deepEqual(spawnCalls, [
      {
        binary: "lark-cli",
        args: ["event", "consume", "card.action.trigger", "--as", "bot"],
      },
    ]);
  } finally {
    stop();
  }
});

test("starts card actions for a read-only overview while reply control is disabled", () => {
  const settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: false,
  };
  const child = new FakeChildProcess();
  const spawnCalls: Array<{ binary: string; args: string[] }> = [];
  const listener = new FeishuReplyEventListener({
    eventKey: "card.action.trigger",
    settings: { get: () => settings },
    spawnProcess: (binary, args) => {
      spawnCalls.push({ binary, args });
      return child;
    },
    handleEvent: async () => undefined,
  });
  const stop = listener.start();

  try {
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.args[2], "card.action.trigger");
  } finally {
    stop();
  }
});

test("reports bounded startup diagnostics when a consumer exits before ready", async () => {
  const settings: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: false,
  };
  const child = new FakeChildProcess();
  const errors: unknown[] = [];
  const listener = new FeishuReplyEventListener({
    eventKey: "application.bot.menu_v6",
    settings: { get: () => settings },
    spawnProcess: () => child,
    handleEvent: async () => undefined,
    logError: (error) => errors.push(error),
  });
  const stop = listener.start();

  try {
    child.stderr.write(
      "requires event subscription: application.bot.menu_v6\n",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.emit("exit", 1, null);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(errors.length, 1);
    assert.match(
      String((errors[0] as Error).message),
      /application\.bot\.menu_v6/,
    );
    assert.match(String((errors[0] as Error).message), /exited before ready/);
  } finally {
    stop();
  }
});
