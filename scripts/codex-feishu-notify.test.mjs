import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCompletionCards,
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

test("keeps formula source and never invokes an image renderer", async () => {
  const event = {
    ...completion,
    "last-assistant-message": "Before $x^2$ and \\[y^2\\] after.",
  };
  const calls = [];
  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify(event),
    env: { FEISHU_NOTIFY_USER_ID: "ou_user123" },
    renderMath: async () => {
      throw new Error("formula renderer must not run");
    },
    runCommand: async (_binary, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({
          ok: true,
          data: { message_id: "om_test", chat_id: "oc_test" },
        }),
      };
    },
  });
  assert.equal(calls.length, 1);
  const card = JSON.parse(calls[0][calls[0].indexOf("--content") + 1]);
  assert.equal(card.config.width_mode, "compact");
  assert.equal(
    card.body.elements[1].elements[0].content,
    event["last-assistant-message"],
  );
  assert.doesNotMatch(JSON.stringify(card), /img_/);
  assert.deepEqual(result.messages, [
    { messageId: "om_test", chatId: "oc_test" },
  ]);
});

test("adds a tiny records callback without exposing session identity", () => {
  const cards = buildCompletionCards(
    {
      ...completion,
      "user-question": "question".repeat(1000),
      "records-available": true,
    },
    1_000,
  );
  for (const card of cards) {
    const button = card.body.elements.at(-1);
    assert.equal(button.tag, "button");
    assert.equal(button.size, "tiny");
    assert.equal(button.width, "default");
    assert.equal(button.type, "primary");
    assert.deepEqual(button.behaviors, [
      {
        type: "callback",
        value: { action: "kanban_completion_records" },
      },
    ]);
    assert.deepEqual(Object.keys(button.behaviors[0].value), ["action"]);
  }
});

test("preserves exact formula source across Unicode chunking", () => {
  for (const prefixLength of [995, 999, 1000]) {
    const cards = buildCompletionCards(
      {
        ...completion,
        "last-assistant-message":
          "中".repeat(prefixLength) + "$x^2$" + "尾".repeat(20),
      },
      1000,
    );
    const chunks = cards.map(
      (card) => card.body.elements[1].elements[0].content,
    );
    assert.equal(
      chunks.join(""),
      "中".repeat(prefixLength) + "$x^2$" + "尾".repeat(20),
    );
  }
});

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
  const contentIndex = calls[0][1].indexOf("--content");
  assert.notEqual(contentIndex, -1);
  assert.match(calls[0][1][contentIndex + 1], /another-project/);
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

test("includes only the explicitly resolved question and keeps user markup inert", () => {
  const [card] = buildCompletionCards({
    ...completion,
    "user-question": "请解释 <at id=all></at>\n第二行",
  });
  const question = card.body.elements[1];
  assert.equal(question.header.title.content, "你的问题");
  assert.equal(question.elements[0].text.tag, "plain_text");
  assert.equal(
    question.elements[0].text.content,
    "请解释 <at id=all></at>\n第二行",
  );
  assert.equal(
    card.body.elements[2].elements[0].content,
    completion["last-assistant-message"],
  );
  assert.doesNotMatch(
    JSON.stringify(card),
    /do not forward this private prompt/,
  );
});

test("long questions have a summary and complete collapsed chunks without truncating the answer", () => {
  const question = "问题😀\n".repeat(800).trim();
  const cards = buildCompletionCards(
    { ...completion, "user-question": question },
    1000,
  );
  assert.match(cards[0].body.elements[1].text.content, /完整问题见后续/);
  assert.equal(
    cards[0].body.elements[2].elements[0].content,
    completion["last-assistant-message"],
  );
  const panels = cards.slice(1).map((card) => card.body.elements[1]);
  assert.ok(panels.every((panel) => panel.expanded === false));
  assert.equal(
    panels.map((panel) => panel.elements[0].text.content).join(""),
    question,
  );
  assert.ok(
    panels.every(
      (panel) => Array.from(panel.elements[0].text.content).length <= 1000,
    ),
  );
});

test("question cards retain delivery bindings and distinct stable retry keys", async () => {
  const event = { ...completion, "user-question": "用户问题".repeat(1000) };
  const calls = [];
  const result = await runCodexFeishuNotification({
    rawNotification: JSON.stringify(event),
    env: {
      FEISHU_NOTIFY_USER_ID: "ou_user123",
      FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS: "1000",
    },
    runCommand: async (_binary, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({
          ok: true,
          data: { message_id: `om_${calls.length}`, chat_id: "oc_test" },
        }),
      };
    },
  });
  assert.ok(calls.length > 1);
  assert.equal(result.messages.length, calls.length);
  assert.deepEqual(
    calls.map((args) => args[args.indexOf("--idempotency-key") + 1]),
    calls.map((_, index) => createIdempotencyKey(event, index)),
  );
});

test("question and answer cards leave room for metadata with multibyte content", () => {
  const cards = buildCompletionCards({
    ...completion,
    "user-question": "问题😀".repeat(5000),
    "last-assistant-message": "回答😀".repeat(5000),
  });
  assert.ok(
    cards.every((card) => Buffer.byteLength(JSON.stringify(card)) < 30 * 1024),
  );
});

test("builds a sanitized Card 2.0 without forwarding the prompt or full path", () => {
  const [card] = buildCompletionCards(
    {
      ...completion,
      "last-assistant-message":
        `Done\u001b[31m!\u001b[0m\u0000\nSee ${completion.cwd}/scripts/notify.mjs\n` +
        "x".repeat(120),
    },
    2_000,
  );

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.width_mode, "compact");
  assert.equal(card.header.template, "green");
  assert.equal(card.header.title.content, "Coding Kanban · Codex 任务完成");
  assert.equal(card.body.elements[0].tag, "column_set");
  assert.equal(card.body.elements[1].tag, "collapsible_panel");
  assert.equal(card.body.elements[1].expanded, true);
  const serialized = JSON.stringify(card);
  const output = card.body.elements[1].elements[0].content;
  assert.equal(card.body.elements[1].elements[0].tag, "markdown");
  assert.match(serialized, /coding_kanban/);
  assert.match(output, /^Done!/);
  assert.match(output, /coding_kanban\/scripts\/notify\.mjs/);
  assert.doesNotMatch(serialized, /do not forward this private prompt/);
  assert.doesNotMatch(serialized, /data01\/home/);
  assert.doesNotMatch(serialized, /\u001b|\u0000/);
  assert.match(output, /x{120}$/);
});

test("preserves the complete last Codex output across Card 2.0 chunks", () => {
  const completeOutput = `第一行\n\n  保留缩进\n${"完整内容".repeat(700)}`;
  const cards = buildCompletionCards(
    {
      ...completion,
      "last-assistant-message": completeOutput,
    },
    1_000,
  );

  assert.ok(cards.length > 1);
  const reconstructed = cards
    .map((card) => card.body.elements[1].elements[0].content)
    .join("");
  assert.equal(reconstructed, completeOutput);
  assert.match(cards[0].body.elements[1].elements[0].content, /  保留缩进/);
  assert.equal(
    cards[0].body.elements[1].header.title.content,
    `完整输出（1/${cards.length}）`,
  );
});

test("renders Markdown output while keeping card metadata plain text", () => {
  const markdown =
    "# 结果\n\n**完成**\n- 测试通过\n\n```ts\nconst x = 1;\n```\n[说明](https://example.com)";
  const [card] = buildCompletionCards({
    ...completion,
    "last-assistant-message": markdown,
  });
  assert.equal(card.body.elements[1].elements[0].tag, "markdown");
  assert.equal(card.body.elements[1].elements[0].content, markdown);
  assert.equal(card.header.title.tag, "plain_text");
});

test("keeps code fences balanced across Markdown cards", () => {
  const code = Array.from(
    { length: 18 },
    (_, index) => `const value${index} = ${index};\n`,
  ).join("");
  const cards = buildCompletionCards(
    { ...completion, "last-assistant-message": "```js\n" + code + "```" },
    100,
  );
  assert.ok(cards.length > 1);
  const bodies = cards.map((card) => card.body.elements[1].elements[0].content);
  for (const body of bodies) {
    assert.match(body, /^```js\n/);
    assert.match(body, /\n```$/);
  }
  assert.equal(
    bodies
      .map((body) => body.replace(/^```js\n/, "").replace(/```$/, ""))
      .join(""),
    code,
  );
});

test("does not turn literal Feishu mention tags into notifications", () => {
  const [card] = buildCompletionCards({
    ...completion,
    "last-assistant-message":
      '**示例** <at id=all></at> <person id="ou_invalid"></person>',
  });
  const body = card.body.elements[1].elements[0].content;
  assert.match(body, /\*\*示例\*\*/);
  assert.doesNotMatch(body, /<\/?(?:at|person)\b/);
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
  assert.equal(
    new Set(
      calls.map(([, args]) => args[args.indexOf("--idempotency-key") + 1]),
    ).size,
    3,
  );
  const firstCard = JSON.parse(
    calls[0][1][calls[0][1].indexOf("--content") + 1],
  );
  const lastCard = JSON.parse(
    calls[2][1][calls[2][1].indexOf("--content") + 1],
  );
  assert.equal(
    firstCard.body.elements[1].header.title.content,
    "完整输出（1/3）",
  );
  assert.equal(
    lastCard.body.elements[1].header.title.content,
    "完整输出（3/3）",
  );
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
  assert.deepEqual(args.slice(8, 11), [
    "--msg-type",
    "interactive",
    "--content",
  ]);
  const card = JSON.parse(args[11]);
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.title.content, "Coding Kanban · Codex 任务完成");
  assert.equal(args[12], "--idempotency-key");
  assert.match(args[13], /^codex-[a-f0-9]+$/);
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
