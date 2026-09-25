import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import {
  FeishuControlPanelService,
  type FeishuCardActionEvent,
  type FeishuControlPanelCardInput,
} from "./feishu-control-panel-service.js";

const session: AgentSessionRecord = {
  id: "session-quick",
  workspaceId: "default",
  sourceType: "local",
  agentKind: "codex",
  displayName: "Quick test",
  workingDirectory: "/repo/test",
  connectionState: "online",
  interactionState: "idle",
  controlMode: "control",
  transportRef: { tmuxSession: "test", tmuxPane: "%1" },
};

const menu = {
  type: "application.bot.menu_v6",
  event_id: "evt_menu",
  event_key: "kanban_quick_replies",
  operator_id: "ou_owner",
};

const notice = {
  type: "card.action.trigger",
  event_id: "evt_notice",
  operator_id: "ou_owner",
  message_id: "om_notice",
  chat_id: "oc_private",
  action_tag: "button",
  action_value: { action: "kanban_completion_quick_reply" },
};

type QuickReplyFixture = ReturnType<typeof fixture>;

function fixture(
  options: {
    failSend?: boolean;
    text?: string;
    requiresEditing?: boolean;
  } = {},
) {
  let current = { ...session };
  let enabled = true;
  let now = 1000;
  let revision = "revision-1";
  let liveIds = ["thread-active", "thread-notified"];
  let duringResolve: (() => void) | undefined;
  let id = 0;
  const cards: FeishuControlPanelCardInput[] = [];
  const sentCards: Array<{ messageId: string; chatId: string }> = [];
  const updatedCards: Array<{
    userId?: string;
    token?: string;
    card: unknown;
  }> = [];
  const texts: string[] = [];
  const sent: Array<{ threadId: string; message: string }> = [];
  const replies = [
    {
      id: "continue",
      label: "继续分析",
      category: "日常",
      text:
        options.text ??
        (options.requiresEditing
          ? "检查 [文件]，给出结果。"
          : "继续分析这个问题。\n保留已有修改。"),
      requiresEditing: options.requiresEditing ?? false,
    },
  ];
  const service = new FeishuControlPanelService({
    allowedUserId: "ou_owner",
    createId: () => "token-" + ++id,
    now: () => now,
    settings: {
      get: () => ({
        configured: true,
        enabled: true,
        destinationType: "user",
        replyConfigured: true,
        replyEnabled: enabled,
      }),
    },
    registry: {
      get: () => current,
      list: () => ({
        items: [current],
        activeAgentSessionId: null,
        updatedAt: "2026-09-23T00:00:00Z",
      }),
    },
    quickReplies: { read: () => ({ items: replies, revision }) },
    notificationBindings: {
      resolve: () => ({
        messageId: "om_notice",
        chatId: "oc_private",
        sessionId: session.id,
        completionId: "turn-1",
        codexThreadId: "thread-notified",
        createdAt: "2026-09-23T00:00:00Z",
      }),
    },
    codex: {
      resolveSessionId: async () => {
        duringResolve?.();
        return liveIds[0];
      },
      resolveSessionIds: async () => {
        duringResolve?.();
        return liveIds;
      },
      sendText: async (input) => {
        sent.push(input);
        if (options.failSend) throw new Error("queue uncertain");
      },
    },
    cards: {
      buildControlPanelCard: (input) => {
        cards.push(input);
        return input;
      },
    },
    messenger: {
      sendCard: async () => {
        const delivery = { messageId: "om_panel_1", chatId: "oc_private" };
        sentCards.push(delivery);
        return delivery;
      },
      updateCard: async (input: {
        userId?: string;
        card: unknown;
        token?: string;
      }) => {
        updatedCards.push(input);
      },
      sendText: async (input: { text: string }) => {
        texts.push(input.text);
      },
    } as any,
  });

  function currentPanel() {
    return cards.at(-1)!;
  }

  function targetSelect(
    overrides: Partial<FeishuCardActionEvent> & Record<string, unknown> = {},
  ): FeishuCardActionEvent {
    const panel = currentPanel();
    return {
      type: "card.action.trigger",
      event_id: "evt_target_" + cards.length,
      operator_id: "ou_owner",
      message_id: "om_panel_1",
      chat_id: "oc_private",
      action_tag: "select_static",
      action_name: "target",
      action_value: { action: "kanban_quick_target", panelId: panel.panelId },
      option: panel.options[0]?.value,
      token: "update-token-1",
      ...overrides,
    } as FeishuCardActionEvent;
  }

  function replySelect(
    overrides: Partial<FeishuCardActionEvent> & Record<string, unknown> = {},
  ): FeishuCardActionEvent {
    const panel = currentPanel();
    return {
      type: "card.action.trigger",
      event_id: "evt_reply_" + cards.length,
      operator_id: "ou_owner",
      message_id: "om_panel_1",
      chat_id: "oc_private",
      action_tag: "select_static",
      action_name: "quickReply",
      action_value: { action: "kanban_quick_preview", panelId: panel.panelId },
      option: panel.quickReplies?.options[0]?.value,
      token: "update-token-2",
      ...overrides,
    } as FeishuCardActionEvent;
  }

  function confirm(
    prompt: string,
    overrides: Partial<FeishuCardActionEvent> = {},
  ): FeishuCardActionEvent {
    const panel = currentPanel();
    return {
      type: "card.action.trigger",
      event_id: "evt_confirm_" + cards.length,
      operator_id: "ou_owner",
      message_id: "om_panel_1",
      chat_id: "oc_private",
      action_tag: "button",
      action_name: "kanban_quick_confirm_" + panel.panelId,
      form_value: { prompt },
      ...overrides,
    };
  }

  function back(
    overrides: Partial<FeishuCardActionEvent> & Record<string, unknown> = {},
  ): FeishuCardActionEvent {
    const panel = currentPanel();
    return {
      type: "card.action.trigger",
      event_id: "evt_back_" + cards.length,
      operator_id: "ou_owner",
      message_id: "om_panel_1",
      chat_id: "oc_private",
      action_tag: "button",
      action_value: { action: "kanban_quick_back", panelId: panel.panelId },
      token: "update-token-back",
      ...overrides,
    } as FeishuCardActionEvent;
  }

  return {
    service,
    cards,
    sentCards,
    updatedCards,
    texts,
    sent,
    replies,
    currentPanel,
    targetSelect,
    replySelect,
    confirm,
    back,
    changeFile: () => {
      revision = "revision-2";
    },
    setSession: (next: AgentSessionRecord) => {
      current = next;
    },
    setIds: (next: string[]) => {
      liveIds = next;
    },
    disable: () => {
      enabled = false;
    },
    expire: () => {
      now += 16 * 60 * 1000;
    },
    duringResolve: (fn: () => void) => {
      duringResolve = fn;
    },
  };
}

async function openMenuToEditor(f: QuickReplyFixture) {
  assert.equal(await f.service.handle(menu), "panel_sent");
  assert.equal(await f.service.handle(f.targetSelect()), "panel_updated");
  assert.equal(await f.service.handle(f.replySelect()), "panel_updated");
}

test("menu quick reply selections update the same card into an editable preview", async () => {
  const f = fixture();
  assert.equal(await f.service.handle(menu), "panel_sent");
  const opened = f.currentPanel();
  assert.equal(f.sentCards.length, 1);
  assert.equal(opened.quickReplies?.boundTargetLabel, undefined);
  assert.equal(await f.service.handle(f.targetSelect()), "panel_updated");
  assert.equal(f.sentCards.length, 1);
  assert.equal(f.updatedCards.at(-1)?.token, "update-token-1");
  assert.equal(f.updatedCards.at(-1)?.userId, "ou_owner");
  assert.match(
    f.currentPanel().quickReplies?.boundTargetLabel ?? "",
    /Quick test/,
  );
  assert.equal(await f.service.handle(f.replySelect()), "panel_updated");
  assert.equal(f.sentCards.length, 1);
  assert.equal(f.updatedCards.at(-1)?.token, "update-token-2");
  assert.equal(
    f.currentPanel().quickReplies?.editor?.text,
    "继续分析这个问题。\n保留已有修改。",
  );
  assert.equal(f.sent.length, 0);
});

test("standalone Feishu dropdown callbacks work without action_name", async () => {
  const f = fixture();
  assert.equal(await f.service.handle(menu), "panel_sent");
  assert.equal(
    await f.service.handle(f.targetSelect({ action_name: undefined })),
    "panel_updated",
  );
  assert.equal(
    await f.service.handle(f.replySelect({ action_name: undefined })),
    "panel_updated",
  );
  assert.equal(f.sentCards.length, 1);
  assert.equal(f.updatedCards.length, 2);
  assert.equal(f.sent.length, 0);
});

test("completion shortcut opens one bound card and selecting a template updates it to preview", async () => {
  const f = fixture();
  assert.equal(await f.service.handle(notice), "panel_sent");
  assert.equal(f.sentCards.length, 1);
  assert.match(
    f.currentPanel().quickReplies?.boundTargetLabel ?? "",
    /Quick test/,
  );
  assert.equal(f.currentPanel().options.length, 1);
  assert.equal(await f.service.handle(f.replySelect()), "panel_updated");
  assert.equal(f.sentCards.length, 1);
  assert.equal(f.updatedCards.length, 1);
  assert.equal(f.updatedCards[0].token, "update-token-2");
  assert.equal(f.currentPanel().quickReplies?.editor?.label, "继续分析");
  assert.equal(f.sent.length, 0);
});

test("confirm is the only quick reply step that sends text to Codex", async () => {
  const f = fixture();
  await openMenuToEditor(f);
  assert.equal(f.sent.length, 0);
  assert.equal(
    await f.service.handle(f.confirm("本次只解释结论。")),
    "delivered",
  );
  assert.equal(f.sent[0].threadId, "thread-active");
  assert.equal(f.sent[0].message, "本次只解释结论。");
  assert.match(f.replies[0].text, /继续分析/);
});

test("bound notification confirm keeps the original inactive Codex thread", async () => {
  const f = fixture();
  assert.equal(await f.service.handle(notice), "panel_sent");
  assert.equal(await f.service.handle(f.replySelect()), "panel_updated");
  assert.equal(
    await f.service.handle(f.confirm("继续处理原来的完成结果。")),
    "delivered",
  );
  assert.equal(f.sent[0].threadId, "thread-notified");
});

test("back from preview updates the same card without sending a new card", async () => {
  const f = fixture();
  await openMenuToEditor(f);
  assert.equal(await f.service.handle(f.back()), "panel_updated");
  assert.equal(f.sentCards.length, 1);
  assert.equal(f.updatedCards.at(-1)?.token, "update-token-back");
  assert.equal(f.currentPanel().quickReplies?.editor, undefined);
  assert.equal(f.sent.length, 0);
});

test("placeholder previews require replacing placeholders before confirm", async () => {
  const f = fixture({ requiresEditing: true });
  await openMenuToEditor(f);
  assert.equal(
    f.currentPanel().quickReplies?.editor?.text,
    "检查 [文件]，给出结果。",
  );
  assert.equal(
    await f.service.handle(f.confirm("检查 [文件]，给出结果。")),
    "ignored_invalid_input",
  );
  assert.equal(f.sent.length, 0);
  assert.equal(
    await f.service.handle(
      f.confirm("检查 README.md，给出结果。", {
        event_id: "evt_confirm_edited",
      }),
    ),
    "delivered",
  );
  assert.equal(f.sent[0].message, "检查 README.md，给出结果。");
});

test("select callbacks preserve user, message, chat and token boundaries", async () => {
  for (const change of [
    { operator_id: "ou_other" },
    { message_id: "om_other" },
    { chat_id: "oc_other" },
    { action_name: "quickReply" },
    { option: "forged" },
    { token: undefined },
  ]) {
    const f = fixture();
    await f.service.handle(menu);
    assert.notEqual(
      await f.service.handle(f.targetSelect(change)),
      "panel_updated",
    );
    assert.equal(f.updatedCards.length, 0);
    assert.equal(f.sent.length, 0);
  }
});

test("quick replies reject stale personal files before and during preview resolution", async () => {
  for (const race of [false, true]) {
    const f = fixture();
    await f.service.handle(menu);
    await f.service.handle(f.targetSelect());
    if (race) f.duringResolve(f.changeFile);
    else f.changeFile();
    assert.equal(
      await f.service.handle(f.replySelect()),
      "ignored_stale_panel",
    );
    assert.equal(f.updatedCards.length, 1);
    assert.equal(f.sent.length, 0);
  }
});

test("quick replies reject disabled, switched and relocated targets before confirm", async () => {
  for (const mutation of [
    (f: QuickReplyFixture) => f.disable(),
    (f: QuickReplyFixture) => f.setIds(["thread-other"]),
    (f: QuickReplyFixture) =>
      f.setSession({ ...session, workingDirectory: "/different" }),
    (f: QuickReplyFixture) => f.setSession({ ...session, agentKind: "claude" }),
  ]) {
    const f = fixture();
    await openMenuToEditor(f);
    mutation(f);
    assert.notEqual(await f.service.handle(f.confirm("继续。")), "delivered");
    assert.equal(f.sent.length, 0);
  }
});

test("completion shortcut rejects another chat and never falls back from a missing original thread", async () => {
  const f = fixture();
  assert.equal(
    await f.service.handle({ ...notice, chat_id: "oc_other" }),
    "ignored_untrusted",
  );
  f.setIds(["thread-active"]);
  assert.equal(await f.service.handle(notice), "ignored_changed_thread");
  assert.equal(f.sentCards.length, 0);
});

test("queue failures and concurrent confirms cannot deliver a quick reply twice", async () => {
  const f = fixture({ failSend: true });
  await openMenuToEditor(f);
  const event = f.confirm("继续推进。");
  const outcomes = await Promise.all([
    f.service.handle(event),
    f.service.handle({ ...event, event_id: "evt_concurrent" }),
  ]);
  assert.ok(outcomes.includes("delivery_uncertain"));
  assert.equal(f.sent.length, 1);
  assert.match(f.texts.at(-1) ?? "", /不会自动重试/);
});

test("long reply previews join bounded Unicode fields without dropping content", async () => {
  const text = "🙂".repeat(999) + "\n尾部内容";
  const f = fixture({ text });
  await openMenuToEditor(f);
  assert.equal(
    await f.service.handle(
      f.confirm("forged", {
        form_value: {
          prompt_0: "🙂".repeat(999) + "\n",
          prompt_1: "新的尾部内容",
          prompt: "forged",
        },
      }),
    ),
    "delivered",
  );
  assert.equal(f.sent[0].message, "🙂".repeat(999) + "\n新的尾部内容");
});

test("reply previews reject oversized or missing parts before consuming the panel", async () => {
  for (const text of ["短模板", "字".repeat(1001)]) {
    const f = fixture({ text });
    await openMenuToEditor(f);
    for (const form_value of [
      { prompt: "字".repeat(1001) },
      { prompt_0: "替换第一段" },
    ]) {
      assert.equal(
        await f.service.handle(
          f.confirm("ignored", {
            event_id: "evt_invalid_" + JSON.stringify(form_value).length,
            form_value,
          }),
        ),
        "ignored_invalid_input",
      );
    }
    assert.equal(f.sent.length, 0);
  }
});

test("existing Codex menu can open quick replies but refuses cross-mode submissions", async () => {
  const f = fixture();
  await f.service.handle({ ...menu, event_key: "kanban_codex_sessions" });
  assert.equal(f.currentPanel().quickRepliesEnabled, true);
  assert.equal(
    await f.service.handle(
      f.back({
        event_id: "evt_open_quick",
        action_value: {
          action: "kanban_quick_replies",
          panelId: f.currentPanel().panelId,
        },
      }),
    ),
    "panel_sent",
  );
  assert.equal(f.sentCards.length, 2);
  assert.equal(f.currentPanel().quickReplies?.options.length, 1);
  assert.equal(
    await f.service.handle({
      type: "card.action.trigger",
      event_id: "evt_cross_mode",
      operator_id: "ou_owner",
      message_id: "om_panel_1",
      chat_id: "oc_private",
      action_tag: "button",
      action_name: "kanban_submit_" + f.currentPanel().panelId,
      form_value: {
        target: f.currentPanel().options[0].value,
        prompt: "bypass",
      },
    }),
    "ignored_invalid_input",
  );
  assert.equal(f.sent.length, 0);
});

test("duplicate update events do not update the card twice", async () => {
  const f = fixture();
  await f.service.handle(menu);
  const event = f.targetSelect();
  assert.equal(await f.service.handle(event), "panel_updated");
  assert.equal(await f.service.handle(event), "ignored_duplicate");
  assert.equal(f.updatedCards.length, 1);
});

test("quick replies recheck control and destination after asynchronous preview resolution", async () => {
  for (const change of [
    (f: QuickReplyFixture) => f.disable(),
    (f: QuickReplyFixture) => f.setSession({ ...session, hidden: true }),
    (f: QuickReplyFixture) =>
      f.setSession({ ...session, sshTarget: { host: "another-host" } }),
  ]) {
    const f = fixture();
    await f.service.handle(menu);
    await f.service.handle(f.targetSelect());
    f.duringResolve(() => change(f));
    assert.notEqual(await f.service.handle(f.replySelect()), "panel_updated");
    assert.equal(f.updatedCards.length, 1);
    assert.equal(f.sent.length, 0);
  }
});
