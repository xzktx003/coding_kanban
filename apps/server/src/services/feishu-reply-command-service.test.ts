import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  FeishuReplyCommandService,
  type FeishuInboundMessageEvent,
} from "./feishu-reply-command-service.js";
import type { FeishuReplyBinding } from "./feishu-reply-binding-store.js";

const binding: FeishuReplyBinding = {
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
    resolvedBinding?: FeishuReplyBinding | null;
    targetSession?: AgentSessionRecord;
    threadId?: string | null;
    sendText?: () => Promise<void>;
  } = {},
) {
  const writes: Array<{ sessionId: string; prompt: string }> = [];
  const processed = new Set<string>();
  const replyBindings = new Map<string, FeishuReplyBinding>();
  const initialBinding = overrides.resolvedBinding ?? binding;
  if (overrides.resolvedBinding !== null) {
    replyBindings.set(initialBinding.messageId, initialBinding);
  }
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
      resolve: (messageId) => replyBindings.get(messageId) ?? null,
      hasProcessed: (messageId) => processed.has(messageId),
      recordProcessedReply: ({ messageId, parent, codexThreadId }) => {
        processed.add(messageId);
        replyBindings.set(messageId, {
          ...parent,
          messageId,
          codexThreadId,
          createdAt: "2026-09-01T12:00:01.000Z",
        });
      },
    },
    registry: {
      get: () => overrides.targetSession ?? session,
    },
    codex: {
      resolveSessionId: async () =>
        overrides.threadId === null
          ? undefined
          : (overrides.threadId ?? "codex-thread-1"),
      sendText: async (input) => {
        writes.push({ sessionId: input.threadId, prompt: input.message });
        await overrides.sendText?.();
      },
    },
  });

  return { service, writes, processed, replyBindings };
}

test("routes a trusted direct reply to the bound Codex terminal exactly once", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.service.handle(validEvent), "delivered");
  assert.deepEqual(fixture.writes, [
    { sessionId: "codex-thread-1", prompt: "继续运行测试" },
  ]);
  assert.equal(fixture.processed.has("om_reply"), true);

  assert.equal(await fixture.service.handle(validEvent), "ignored_duplicate");
  assert.equal(fixture.writes.length, 1);
});

test("keeps a delivered reply bound for a follow-up reply in the same thread", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.service.handle(validEvent), "delivered");
  assert.equal(
    await fixture.service.handle({
      ...validEvent,
      message_id: "om_follow_up",
      reply_to: "om_reply",
      content: "继续下一步",
    }),
    "delivered",
  );
  assert.deepEqual(fixture.writes, [
    { sessionId: "codex-thread-1", prompt: "继续运行测试" },
    { sessionId: "codex-thread-1", prompt: "继续下一步" },
  ]);
});

test("uses the bound thread root when the direct parent predates reply inheritance", async () => {
  const fixture = createFixture();

  assert.equal(
    await fixture.service.handle({
      ...validEvent,
      message_id: "om_legacy_follow_up",
      reply_to: "om_legacy_user_reply",
      root_id: "om_notice",
      content: "继续旧回复链",
    }),
    "delivered",
  );
  assert.deepEqual(fixture.writes, [
    { sessionId: "codex-thread-1", prompt: "继续旧回复链" },
  ]);
});

test("passes multiline Feishu replies to prompt input handling", async () => {
  const fixture = createFixture();
  const event = {
    ...validEvent,
    message_id: "om_multiline",
    content: "先检查\n然后修复",
  };

  assert.equal(await fixture.service.handle(event), "delivered");
  assert.deepEqual(fixture.writes, [
    { sessionId: "codex-thread-1", prompt: "先检查\n然后修复" },
  ]);
});

test("extracts rendered text from a trusted Feishu post reply", async () => {
  const fixture = createFixture();
  const event = {
    ...validEvent,
    message_id: "om_post_reply",
    message_type: "post",
    content: "第一项\n\n继续执行后续检查",
  };

  assert.equal(await fixture.service.handle(event), "delivered");
  assert.deepEqual(fixture.writes, [
    {
      sessionId: "codex-thread-1",
      prompt: "第一项\n\n继续执行后续检查",
    },
  ]);
  assert.equal(fixture.processed.has("om_post_reply"), true);
});

test("does not queue a reply when the active Codex thread cannot be resolved", async () => {
  const fixture = createFixture({ threadId: null });
  assert.equal(await fixture.service.handle(validEvent), "ignored_unavailable");
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.processed.size, 0);
});

test("queues the complete goal instruction on a running thread without terminal keystrokes", async () => {
  const fixture = createFixture({
    targetSession: { ...session, interactionState: "running" },
  });
  const content = "/goal 继续训练\n目标超过基线";
  assert.equal(
    await fixture.service.handle({ ...validEvent, content }),
    "delivered",
  );
  assert.deepEqual(fixture.writes, [
    { sessionId: "codex-thread-1", prompt: content },
  ]);
});

test("waits for native queue acknowledgement and deduplicates in-flight events", async () => {
  let acknowledge!: () => void;
  const fixture = createFixture({
    sendText: () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  });
  const pending = fixture.service.handle(validEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.processed.size, 0);
  assert.equal(await fixture.service.handle(validEvent), "ignored_duplicate");
  acknowledge();
  assert.equal(await pending, "delivered");
  assert.equal(fixture.processed.size, 1);
  assert.equal(fixture.writes.length, 1);
});

test("rejects messages that are not a trusted private textual reply", async () => {
  const cases: Array<Partial<FeishuInboundMessageEvent>> = [
    { sender_id: "ou_other" },
    { sender_type: "bot" },
    { chat_type: "group" },
    { message_type: "image" },
    { message_type: "post", content: "bad\x1b[31m" },
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
    { ...session, hostId: "remote-host-without-ssh-target" },
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
      recordProcessedReply: ({ messageId }) => processed.add(messageId),
    },
    registry: { get: () => session },
    codex: {
      resolveSessionId: async () => "codex-thread-1",
      sendText: async () => {
        throw new Error("terminal unavailable");
      },
    },
  });

  await assert.rejects(service.handle(validEvent), /terminal unavailable/);
  assert.equal(processed.has("om_reply"), false);
});
