import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCompletionMessage,
  createIdempotencyKey,
  parseLarkCliResponse,
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

  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify({
      ...completion,
      cwd: "/tmp/a-different-project",
    }),
    env: {},
    runCommand: async () => {
      calls += 1;
      return { stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(calls, 0);
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

test("builds a bounded plain-text message without forwarding the prompt or full path", () => {
  const message = buildCompletionMessage(
    {
      ...completion,
      "last-assistant-message":
        `Done\u001b[31m!\u001b[0m\u0000\nSee ${completion.cwd}/scripts/notify.mjs\n` +
        "x".repeat(120),
    },
    80,
  );

  assert.match(message, /^Coding Kanban · Codex 任务完成/m);
  assert.match(message, /项目：coding_kanban/);
  assert.match(message, /摘要：Done!/);
  assert.match(message, /coding_kanban\/scripts\/notify\.mjs/);
  assert.doesNotMatch(message, /do not forward this private prompt/);
  assert.doesNotMatch(message, /data01\/home/);
  assert.doesNotMatch(message, /\u001b|\u0000/);
  assert.ok(message.length < 180);
  assert.match(message, /…$/);
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
        stdout: '{"ok":true,"identity":"bot","data":{"message_id":"om_123"}}',
        stderr: "",
      };
    },
  });

  assert.deepEqual(result, {
    status: "sent",
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
