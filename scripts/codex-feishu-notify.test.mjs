import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCompletionMessage,
  buildCompletionMessages,
  createIdempotencyKey,
  parseLarkCliResponse,
  readCodexHookNotificationEnabled,
  readKanbanNotificationEnabled,
  runCodexFeishuNotification,
} from "./codex-feishu-notify.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const completion = {
  type: "agent-turn-complete",
  "thread-id": "thread-123",
  "turn-id": "turn-456",
  cwd: repositoryRoot,
  "input-messages": ["do not forward this private prompt"],
  "last-assistant-message": "Implemented the requested notification bridge.",
};

test("reads the persisted Feishu switch with backward-compatible defaults", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "codex-feishu-switch-"));
  const statePath = resolve(directory, "settings.json");
  try {
    assert.equal(readCodexHookNotificationEnabled(statePath), true);
    assert.equal(readKanbanNotificationEnabled(statePath), true);
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, enabled: false }),
      "utf8",
    );
    assert.equal(readCodexHookNotificationEnabled(statePath), false);
    assert.equal(readKanbanNotificationEnabled(statePath), false);
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 2,
        enabled: true,
        deliveryMode: "kanban",
      }),
      "utf8",
    );
    assert.equal(readCodexHookNotificationEnabled(statePath), false);
    assert.equal(readKanbanNotificationEnabled(statePath), true);
    writeFileSync(statePath, "not-json", "utf8");
    assert.throws(
      () => readCodexHookNotificationEnabled(statePath),
      /notification settings/i,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("allows the Kanban backend to notify for sessions outside this repository", async () => {
  const calls = [];
  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify({
      ...completion,
      cwd: "/workspace/another-project",
    }),
    env: {
      FEISHU_NOTIFY_USER_ID: "ou_user123",
      FEISHU_NOTIFY_MAX_ATTEMPTS: "1",
    },
    enforceRepositoryScope: false,
    runCommand: async (...args) => {
      calls.push(args);
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(result, { status: "sent", messages: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0][1][9], /another-project/);
});

test("does not invoke lark-cli when the persisted Feishu switch is off", async () => {
  let calls = 0;
  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify(completion),
    env: {},
    resolveNotificationEnabled: () => false,
    runCommand: async () => {
      calls += 1;
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(result, { status: "disabled" });
  assert.equal(calls, 0);
});

test("ignores Codex notification types that are not agent-turn-complete", async () => {
  let calls = 0;

  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify({ type: "approval-requested" }),
    env: {},
    runCommand: async () => {
      calls += 1;
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(calls, 0);
});

test("ignores completion events outside this repository", async () => {
  let calls = 0;
  let settingsReads = 0;

  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify({
      ...completion,
      cwd: "/tmp/a-different-project",
    }),
    env: {},
    resolveNotificationEnabled: () => {
      settingsReads += 1;
      return true;
    },
    runCommand: async () => {
      calls += 1;
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(calls, 0);
  assert.equal(settingsReads, 0);
});

test("requires exactly one validated Feishu destination", async () => {
  await assert.rejects(
    runCodexFeishuNotification({
      rawNotification: JSON.stringify(completion),
      env: {},
    }),
    /exactly one of FEISHU_NOTIFY_CHAT_ID or FEISHU_NOTIFY_USER_ID/i,
  );

  await assert.rejects(
    runCodexFeishuNotification({
      rawNotification: JSON.stringify(completion),
      env: {
        FEISHU_NOTIFY_CHAT_ID: "--help",
      },
    }),
    /FEISHU_NOTIFY_CHAT_ID.*invalid/i,
  );

  await assert.rejects(
    runCodexFeishuNotification({
      rawNotification: JSON.stringify(completion),
      env: {
        FEISHU_NOTIFY_CHAT_ID: "oc_group123",
        FEISHU_NOTIFY_USER_ID: "ou_user123",
      },
    }),
    /exactly one of FEISHU_NOTIFY_CHAT_ID or FEISHU_NOTIFY_USER_ID/i,
  );
});

test("builds sanitized plain text without forwarding the prompt or full path", () => {
  const message = buildCompletionMessage(
    {
      ...completion,
      "last-assistant-message":
        `Done\u001b[31m!\u001b[0m\u0000\nSee ${completion.cwd}/scripts/notify.mjs\n` +
        "x".repeat(120),
    },
    2_000,
  );

  assert.match(message, /^Coding Kanban · Codex 任务完成/m);
  assert.match(message, /项目：coding_kanban/);
  assert.match(message, /最后输出：\nDone!/);
  assert.match(message, /coding_kanban\/scripts\/notify\.mjs/);
  assert.doesNotMatch(message, /do not forward this private prompt/);
  assert.doesNotMatch(message, /data01\/home/);
  assert.doesNotMatch(message, /\u001b|\u0000/);
  assert.match(message, /x{120}$/);
});

test("preserves the complete last Codex output across plain-text message chunks", () => {
  const completeOutput = `第一行\n\n  保留缩进\n${"完整内容".repeat(700)}`;
  const messages = buildCompletionMessages(
    {
      ...completion,
      "last-assistant-message": completeOutput,
    },
    1_000,
  );

  assert.ok(messages.length > 1);
  const reconstructed = messages
    .map((message) => message.replace(/^[\s\S]*最后输出（\d+\/\d+）：\n/, ""))
    .join("");
  assert.equal(reconstructed, completeOutput);
  assert.match(messages[0], /  保留缩进/);
});

test("sends every complete output chunk with a distinct idempotency key", async () => {
  const calls = [];
  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify({
      ...completion,
      "last-assistant-message": "完整输出".repeat(600),
    }),
    env: {
      FEISHU_NOTIFY_USER_ID: "ou_user123",
      FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS: "1000",
      FEISHU_NOTIFY_MAX_ATTEMPTS: "1",
    },
    enforceRepositoryScope: false,
    runCommand: async (...args) => {
      calls.push(args);
      return {
        stdout: `{"ok":true,"data":{"message_id":"om_${calls.length}","chat_id":"oc_private"}}`,
        stderr: "",
      };
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(result, {
    status: "sent",
    messages: [
      { messageId: "om_1", chatId: "oc_private" },
      { messageId: "om_2", chatId: "oc_private" },
      { messageId: "om_3", chatId: "oc_private" },
    ],
    messageIds: ["om_1", "om_2", "om_3"],
  });
  assert.equal(new Set(calls.map(([, args]) => args[11])).size, 3);
  assert.match(calls[0][1][9], /最后输出（1\/3）：/);
  assert.match(calls[2][1][9], /最后输出（3\/3）：/);
});

test("uses a stable, bounded idempotency key per Codex turn", () => {
  const key = createIdempotencyKey(completion);

  assert.equal(key, createIdempotencyKey({ ...completion }));
  assert.notEqual(
    key,
    createIdempotencyKey({ ...completion, "turn-id": "turn-789" }),
  );
  assert.match(key, /^codex-[a-f0-9]+$/);
  assert.ok(key.length <= 50);
});

test("sends through lark-cli with fixed bot identity and a group target", async () => {
  const calls = [];

  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify(completion),
    env: {
      FEISHU_NOTIFY_CHAT_ID: "oc_group123",
      FEISHU_NOTIFY_MAX_ATTEMPTS: "1",
    },
    runCommand: async (...args) => {
      calls.push(args);
      return {
        stdout:
          '{"ok":true,"identity":"bot","data":{"message_id":"om_123","chat_id":"oc_group123"}}',
        stderr: "",
      };
    },
  });

  assert.deepEqual(result, {
    status: "sent",
    messages: [{ messageId: "om_123", chatId: "oc_group123" }],
    messageId: "om_123",
  });
  assert.equal(calls.length, 1);
  const [binary, args, options] = calls[0];
  assert.equal(binary, "lark-cli");
  assert.deepEqual(args.slice(0, 8), [
    "im",
    "+messages-send",
    "--format",
    "json",
    "--as",
    "bot",
    "--chat-id",
    "oc_group123",
  ]);
  assert.equal(args[8], "--text");
  assert.match(args[9], /Coding Kanban · Codex 任务完成/);
  assert.equal(args[10], "--idempotency-key");
  assert.match(args[11], /^codex-[a-f0-9]+$/);
  assert.equal(options.timeout, 10_000);
  assert.equal(options.env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER, "1");
  assert.equal(options.env.LARKSUITE_CLI_NO_SKILLS_NOTIFIER, "1");
});

test("supports direct messages through a validated user open_id", async () => {
  let sentArgs;

  await runCodexFeishuNotification({
    rawNotification: JSON.stringify(completion),
    env: {
      FEISHU_NOTIFY_USER_ID: "ou_user123",
      FEISHU_NOTIFY_MAX_ATTEMPTS: "1",
    },
    runCommand: async (_binary, args) => {
      sentArgs = args;
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(sentArgs.slice(6, 8), ["--user-id", "ou_user123"]);
});

test("retries with the same idempotency key after a transient command failure", async () => {
  const keys = [];
  const waits = [];
  let attempts = 0;

  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify(completion),
    env: {
      FEISHU_NOTIFY_CHAT_ID: "oc_group123",
      FEISHU_NOTIFY_MAX_ATTEMPTS: "2",
    },
    sleep: async (milliseconds) => waits.push(milliseconds),
    runCommand: async (_binary, args) => {
      attempts += 1;
      keys.push(args[args.indexOf("--idempotency-key") + 1]);
      if (attempts === 1) {
        const error = new Error("temporary network failure");
        error.code = 1;
        error.stderr = '{"ok":false,"error":{"type":"network"}}';
        throw error;
      }
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.equal(result.status, "sent");
  assert.equal(attempts, 2);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(waits, [250]);
});

test("does not retry authorization failures", async () => {
  let attempts = 0;

  await assert.rejects(
    runCodexFeishuNotification({
      rawNotification: JSON.stringify(completion),
      env: {
        FEISHU_NOTIFY_CHAT_ID: "oc_group123",
        FEISHU_NOTIFY_MAX_ATTEMPTS: "3",
      },
      sleep: async () => assert.fail("authorization failures must not retry"),
      runCommand: async () => {
        attempts += 1;
        const error = new Error("authorization failed");
        error.code = 1;
        error.stderr = JSON.stringify({
          ok: false,
          error: {
            type: "authorization",
            subtype: "missing_scope",
            message: "missing bot scope",
          },
        });
        throw error;
      },
    }),
    /missing_scope: missing bot scope/,
  );

  assert.equal(attempts, 1);
});

test("accepts only the lark-cli ok=true success envelope", () => {
  assert.deepEqual(parseLarkCliResponse('{"ok":true,"data":{}}'), {
    ok: true,
    data: {},
  });
  assert.throws(() => parseLarkCliResponse('{"code":0,"msg":"ok"}'), {
    message: /ok=true/i,
  });
  assert.throws(() => parseLarkCliResponse('{"ok":false}'), {
    message: /ok=true/i,
  });
  assert.throws(() => parseLarkCliResponse("not-json"), {
    message: /valid JSON/i,
  });
});
