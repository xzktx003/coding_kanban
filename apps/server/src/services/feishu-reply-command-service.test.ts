import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  FeishuReplyCommandService,
  buildFeishuPromptInput,
  type FeishuInboundMessageEvent,
} from "./feishu-reply-command-service.js";

const binding = {
  messageId: "om_notice",
  chatId: "oc_private",
  sessionId: "session-1",
  completionId: "turn-1",
  createdAt: "2026-09-01T12:00:00.000Z",
};

const session: AgentSessionRecord = {
  id: "session-1",
  workspaceId: "default",
  sourceType: "local",
  agentKind: "codex",
  displayName: "coding-kanban",
  connectionState: "online",
  interactionState: "idle",
  controlMode: "control",
  transportRef: { tmuxSession: "coding-kanban", tmuxPane: "%1" },
};

const validEvent: FeishuInboundMessageEvent = {
  type: "im.message.receive_v1",
  message_id: "om_reply",
  reply_to: "om_notice",
  chat_id: "oc_private",
  chat_type: "p2p",
  sender_id: "ou_owner",
  sender_type: "user",
  message_type: "text",
  content: "继续运行测试",
};

function createFixture(
  overrides: {
    replyEnabled?: boolean;
    resolvedBinding?: typeof binding | null;
    targetSession?: AgentSessionRecord;
  } = {},
) {
  const writes: Array<{ sessionId: string; input: string }> = [];
  const processed = new Set<string>();
  const service = new FeishuReplyCommandService({
    allowedUserId: "ou_owner",
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
        replyConfigured: true,
        replyEnabled: overrides.replyEnabled ?? true,
      }),
    },
    bindings: {
      resolve: () => overrides.resolvedBinding ?? binding,
      hasProcessed: (messageId) => processed.has(messageId),
      markProcessed: (messageId) => {
        processed.add(messageId);
      },
    },
    registry: {
      get: () => overrides.targetSession ?? session,
    },
    input: {
      write: async (sessionId, input) => {
        writes.push({ sessionId, input });
      },
    },
  });

  return { service, writes, processed };
}

test("routes a trusted direct reply to the bound Codex terminal exactly once", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.service.handle(validEvent), "delivered");
  assert.deepEqual(fixture.writes, [
    { sessionId: "session-1", input: "继续运行测试\r" },
  ]);
  assert.equal(fixture.processed.has("om_reply"), true);

  assert.equal(await fixture.service.handle(validEvent), "ignored_duplicate");
  assert.equal(fixture.writes.length, 1);
});

test("uses bracketed paste for a multiline Feishu prompt", () => {
  assert.equal(
    buildFeishuPromptInput("先检查\n然后修复"),
    "\x1b[200~先检查\n然后修复\x1b[201~\r",
  );
});

test("rejects messages that are not a trusted private text reply", async () => {
  const cases: Array<Partial<FeishuInboundMessageEvent>> = [
    { sender_id: "ou_other" },
    { sender_type: "bot" },
    { chat_type: "group" },
    { message_type: "image" },
    { reply_to: undefined },
    { chat_id: "oc_other" },
    { content: "bad\x1b[31m" },
    { content: "" },
  ];

  for (const changes of cases) {
    const fixture = createFixture();
    const event = { ...validEvent, ...changes };
    assert.notEqual(await fixture.service.handle(event), "delivered");
    assert.equal(fixture.writes.length, 0);
  }
});

test("requires an enabled reply switch and a live controllable Codex session", async () => {
  assert.equal(
    await createFixture({ replyEnabled: false }).service.handle(validEvent),
    "ignored_disabled",
  );

  for (const targetSession of [
    { ...session, agentKind: "claude" },
    { ...session, connectionState: "offline" as const },
    { ...session, interactionState: "exited" as const },
    { ...session, controlMode: "observe" as const },
  ]) {
    const fixture = createFixture({ targetSession });
    assert.equal(
      await fixture.service.handle(validEvent),
      "ignored_unavailable",
    );
    assert.equal(fixture.writes.length, 0);
  }
});

test("does not mark an inbound message processed when terminal delivery fails", async () => {
  const processed = new Set<string>();
  const service = new FeishuReplyCommandService({
    allowedUserId: "ou_owner",
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
        replyConfigured: true,
        replyEnabled: true,
      }),
    },
    bindings: {
      resolve: () => binding,
      hasProcessed: (messageId) => processed.has(messageId),
      markProcessed: (messageId) => processed.add(messageId),
    },
    registry: { get: () => session },
    input: {
      write: async () => {
        throw new Error("terminal unavailable");
      },
    },
  });

  await assert.rejects(service.handle(validEvent), /terminal unavailable/);
  assert.equal(processed.has("om_reply"), false);
});
