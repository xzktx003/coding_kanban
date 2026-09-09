import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  FeishuNotificationSettingsResponse,
} from "@agent-orchestrator/shared";

import {
  FeishuControlPanelService,
  type FeishuCardActionEvent,
  type FeishuControlPanelCardInput,
  type FeishuMenuEvent,
} from "./feishu-control-panel-service.js";

const baseSettings: FeishuNotificationSettingsResponse = {
  configured: true,
  destinationType: "user",
  enabled: true,
  replyConfigured: true,
  replyEnabled: true,
};

const codexSession: AgentSessionRecord = {
  id: "session-1",
  workspaceId: "default",
  sourceType: "local",
  agentKind: "codex",
  displayName: "coding-kanban",
  workingDirectory: "/repo/coding-kanban",
  connectionState: "online",
  interactionState: "idle",
  controlMode: "control",
  transportRef: { tmuxSession: "coding-kanban", tmuxPane: "%1" },
};

const unavailableSession: AgentSessionRecord = {
  ...codexSession,
  id: "session-2",
  displayName: "observer",
  controlMode: "observe",
};

const menuEvent: FeishuMenuEvent = {
  type: "application.bot.menu_v6",
  event_id: "evt_menu",
  event_key: "kanban_codex_sessions",
  operator_id: "ou_owner",
};

const overviewMenuEvent: FeishuMenuEvent = {
  ...menuEvent,
  event_id: "evt_overview_menu",
  event_key: "kanban_task_overview",
};

const submitEvent: FeishuCardActionEvent = {
  type: "card.action.trigger",
  event_id: "evt_submit",
  operator_id: "ou_owner",
  message_id: "om_panel",
  chat_id: "oc_private",
  action_tag: "button",
  action_name: "kanban_submit_panel-1",
  form_value: JSON.stringify({
    target: "target-1",
    prompt: "继续执行测试",
  }),
};

function createFixture(
  overrides: {
    settings?: FeishuNotificationSettingsResponse;
    sessions?: AgentSessionRecord[];
    currentThreadId?: string;
    nowMs?: number;
    resolveSessionId?: (session: AgentSessionRecord) => Promise<string>;
    sendText?: (input: {
      threadId: string;
      message: string;
      workingDirectory?: string;
    }) => Promise<void>;
  } = {},
) {
  let sessions = overrides.sessions ?? [codexSession, unavailableSession];
  let settings = overrides.settings ?? baseSettings;
  let currentThreadId = overrides.currentThreadId ?? "codex-thread-1";
  let nowMs = overrides.nowMs ?? 1_000;
  const cards: FeishuControlPanelCardInput[] = [];
  const sentCards: Array<{
    card: unknown;
    idempotencyKey: string;
    userId?: string;
    chatId?: string;
  }> = [];
  const sentTexts: Array<{
    chatId: string;
    text: string;
    idempotencyKey: string;
  }> = [];
  const deliveries: Array<{
    threadId: string;
    message: string;
    workingDirectory?: string;
  }> = [];
  const ids = ["panel-1", "target-1", "panel-2", "target-2"];
  const service = new FeishuControlPanelService({
    allowedUserId: "ou_owner",
    now: () => nowMs,
    createId: () => {
      return ids.shift() ?? `id-${cards.length}`;
    },
    settings: {
      get: () => settings,
    },
    registry: {
      list: () => ({
        items: sessions,
        activeAgentSessionId: null,
        updatedAt: new Date(nowMs).toISOString(),
      }),
      get: (sessionId) => {
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
          throw new Error("missing session");
        }
        return session;
      },
    },
    codex: {
      resolveSessionId: async (input) =>
        overrides.resolveSessionId?.(input) ?? currentThreadId,
      sendText: async (input) => {
        deliveries.push(input);
        await overrides.sendText?.(input);
      },
    },
    cards: {
      buildControlPanelCard: (input) => {
        cards.push(input);
        return { card: input };
      },
    },
    messenger: {
      sendCard: async (input) => {
        sentCards.push(input);
        return { messageId: "om_panel", chatId: "oc_private" };
      },
      sendText: async (input) => {
        sentTexts.push(input);
      },
    },
  });

  return {
    service,
    cards,
    deliveries,
    sentCards,
    sentTexts,
    setSessions: (next: AgentSessionRecord[]) => {
      sessions = next;
    },
    setSettings: (next: FeishuNotificationSettingsResponse) => {
      settings = next;
    },
    setCurrentThreadId: (next: string) => {
      currentThreadId = next;
    },
    advanceMs: (delta: number) => {
      nowMs += delta;
    },
  };
}

test("menu click sends a fresh private control card with only live controllable Codex targets", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.service.handle(menuEvent), "panel_sent");
  assert.equal(fixture.sentCards.length, 1);
  assert.equal(fixture.cards.length, 1);
  assert.deepEqual(fixture.cards[0], {
    panelId: "panel-1",
    options: [
      {
        value: "target-1",
        label: "coding-kanban [session-] · /repo/coding-kanban",
      },
    ],
    truncated: false,
    page: 1,
    pageCount: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });
});

test("overview menu sends paged visible task summary while binding only current page Codex targets", async () => {
  const hiddenSession: AgentSessionRecord = {
    ...codexSession,
    id: "session-hidden",
    displayName: "hidden",
    hidden: true,
  };
  const runningSession: AgentSessionRecord = {
    ...codexSession,
    interactionState: "running",
    stateConfidence: "low",
    lastAgentMessageSummary: "\u001b[31m正在执行长任务\u001b[0m",
  };
  const awaitingSession: AgentSessionRecord = {
    ...codexSession,
    id: "session-awaiting",
    displayName: "needs-input",
    interactionState: "awaiting_input",
    lastAgentMessageSummary: "请选择下一步",
  };
  const idleNodeSession: AgentSessionRecord = {
    ...codexSession,
    id: "session-node",
    displayName: "node-shell",
    agentKind: "node-shell-agent-kind-name-that-is-too-long",
    interactionState: "idle",
    agentSessionId: undefined,
    lastAgentMessageSummary: " \t",
    outputPreview: `完成${"好".repeat(400)}`,
  };
  const offlineSession: AgentSessionRecord = {
    ...codexSession,
    id: "session-offline",
    displayName: "offline",
    connectionState: "offline",
    interactionState: "running",
    outputPreview: "连接断开",
  };
  const exitedSession: AgentSessionRecord = {
    ...codexSession,
    id: "session-exited",
    displayName: "done",
    interactionState: "exited",
    outputPreview: "已退出",
  };
  const fixture = createFixture({
    sessions: [
      runningSession,
      awaitingSession,
      idleNodeSession,
      offlineSession,
      exitedSession,
      hiddenSession,
    ],
    nowMs: Date.parse("2026-09-09T03:04:05.000Z"),
    resolveSessionId: async (session) => {
      if (session.id === "session-awaiting") {
        throw new Error("transcript unavailable");
      }
      if (session.id === "session-node") {
        return "";
      }
      return `thread-${session.id}`;
    },
  });

  assert.equal(await fixture.service.handle(overviewMenuEvent), "panel_sent");
  assert.equal(fixture.cards.length, 1);
  assert.deepEqual(fixture.cards[0]?.options, [
    {
      value: "target-1",
      label: "coding-kanban [session-] · /repo/coding-kanban",
    },
  ]);
  assert.deepEqual(fixture.cards[0]?.overview, {
    updatedAt: "2026-09-09T03:04:05.000Z",
    total: 5,
    running: 1,
    awaitingInput: 1,
    idle: 1,
    unavailable: 2,
    entries: [
      {
        label: "coding-kanban [session-] · /repo/coding-kanban",
        status: "运行中（状态不确定）",
        summary: "正在执行长任务",
      },
      {
        label: "needs-input [session-] · /repo/coding-kanban",
        status: "等待输入",
        summary: "请选择下一步",
      },
      {
        label: "node-shell [session-] · /repo/coding-kanban",
        status: "空闲 · node-shell-agent-kind-name-th...",
        summary: `完成${"好".repeat(295)}...`,
      },
      {
        label: "offline [session-] · /repo/coding-kanban",
        status: "不可用",
        summary: "连接断开",
      },
      {
        label: "done [session-] · /repo/coding-kanban",
        status: "不可用",
        summary: "已退出",
      },
    ],
  });
});

test("overview pagination and refresh preserve overview mode from server-side panel state", async () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    ...codexSession,
    id: `session-${index + 1}`,
    displayName: `codex-${index + 1}`,
  }));
  const fixture = createFixture({ sessions });

  assert.equal(await fixture.service.handle(overviewMenuEvent), "panel_sent");
  assert.equal(fixture.cards[0]?.overview?.entries.length, 10);
  assert.equal(fixture.cards[0]?.page, 1);
  assert.equal(fixture.cards[0]?.pageCount, 2);

  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_overview_page_2",
      action_name: "kanban_page",
      form_value: "",
      action_value: JSON.stringify({
        action: "kanban_page",
        panelId: "panel-1",
        page: 2,
        mode: "control",
      }),
    }),
    "panel_sent",
  );
  assert.equal(fixture.cards[1]?.overview?.entries.length, 2);
  assert.equal(fixture.cards[1]?.options.length, 2);
  assert.equal(fixture.cards[1]?.page, 2);
  assert.equal(fixture.cards[1]?.hasPreviousPage, true);

  const pageTwoPanelId = fixture.cards[1]?.panelId;
  assert.equal(typeof pageTwoPanelId, "string");
  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_overview_refresh",
      action_name: "kanban_refresh",
      form_value: "",
      action_value: JSON.stringify({
        action: "kanban_refresh",
        panelId: pageTwoPanelId,
        mode: "control",
      }),
      message_id: "om_panel",
      chat_id: "oc_private",
    }),
    "panel_sent",
  );
  assert.ok(fixture.cards[2]?.overview);
  assert.equal(fixture.cards[2]?.page, 1);
});

test("overview submit keeps the same forged callback and exact thread protections", async () => {
  const fixture = createFixture();
  await fixture.service.handle(overviewMenuEvent);

  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_overview_wrong_user",
      operator_id: "ou_other",
    }),
    "ignored_untrusted",
  );
  assert.deepEqual(fixture.deliveries, []);

  fixture.setCurrentThreadId("codex-thread-2");
  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_overview_changed_thread",
    }),
    "ignored_changed_thread",
  );
  assert.deepEqual(fixture.deliveries, []);
});

test("overview submit refuses a target that became hidden after the panel was sent", async () => {
  const fixture = createFixture();
  await fixture.service.handle(overviewMenuEvent);
  fixture.setSessions([{ ...codexSession, hidden: true }]);

  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_overview_hidden",
    }),
    "ignored_unavailable",
  );
  assert.deepEqual(fixture.deliveries, []);
});

test("overview send rechecks enabled settings after resolving card targets", async () => {
  let fixture = createFixture({
    resolveSessionId: async () => {
      fixture.setSettings({ ...baseSettings, replyEnabled: false });
      return "codex-thread-1";
    },
  });

  assert.equal(
    await fixture.service.handle(overviewMenuEvent),
    "ignored_disabled",
  );
  assert.equal(fixture.sentCards.length, 0);
});

test("deduplicates repeated menu callbacks without creating a second panel", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.service.handle(menuEvent), "panel_sent");
  assert.equal(await fixture.service.handle(menuEvent), "ignored_duplicate");
  assert.equal(fixture.cards.length, 1);
});

test("submits a prompt to the exact Codex thread captured by the panel", async () => {
  const fixture = createFixture();
  await fixture.service.handle(menuEvent);

  assert.equal(await fixture.service.handle(submitEvent), "delivered");
  assert.deepEqual(fixture.deliveries, [
    {
      threadId: "codex-thread-1",
      message: "继续执行测试",
      workingDirectory: "/repo/coding-kanban",
      sshTarget: undefined,
    },
  ]);
});

test("rejects submit when user, card, chat, session, or Codex thread changed", async () => {
  const untrusted = createFixture();
  await untrusted.service.handle(menuEvent);
  assert.equal(
    await untrusted.service.handle({
      ...submitEvent,
      event_id: "evt_other_user",
      operator_id: "ou_other",
    }),
    "ignored_untrusted",
  );
  assert.deepEqual(untrusted.deliveries, []);

  const wrongCard = createFixture();
  await wrongCard.service.handle(menuEvent);
  assert.equal(
    await wrongCard.service.handle({
      ...submitEvent,
      event_id: "evt_other_card",
      message_id: "om_other",
    }),
    "ignored_stale_panel",
  );
  assert.deepEqual(wrongCard.deliveries, []);

  const unavailable = createFixture();
  await unavailable.service.handle(menuEvent);
  unavailable.setSessions([{ ...codexSession, interactionState: "exited" }]);
  assert.equal(
    await unavailable.service.handle({
      ...submitEvent,
      event_id: "evt_unavailable",
    }),
    "ignored_unavailable",
  );
  assert.deepEqual(unavailable.deliveries, []);

  const changedThread = createFixture();
  await changedThread.service.handle(menuEvent);
  changedThread.setCurrentThreadId("codex-thread-2");
  assert.equal(
    await changedThread.service.handle({
      ...submitEvent,
      event_id: "evt_changed_thread",
    }),
    "ignored_changed_thread",
  );
  assert.deepEqual(changedThread.deliveries, []);
});

test("deduplicates in-flight and retried submit callbacks", async () => {
  let acknowledge!: () => void;
  const fixture = createFixture({
    sendText: async () => {
      await new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    },
  });
  await fixture.service.handle(menuEvent);

  const pending = fixture.service.handle(submitEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await fixture.service.handle(submitEvent), "ignored_duplicate");
  acknowledge();
  assert.equal(await pending, "delivered");
  assert.equal(await fixture.service.handle(submitEvent), "ignored_duplicate");
  assert.equal(fixture.deliveries.length, 1);

  assert.equal(
    await fixture.service.handle({ ...submitEvent, event_id: "evt_submit_2" }),
    "ignored_stale_panel",
  );
  assert.equal(fixture.deliveries.length, 1);
});

test("allows only one concurrent submit from the same panel even with different event ids", async () => {
  let resolveThread!: () => void;
  let resolveCount = 0;
  const fixture = createFixture({
    resolveSessionId: async () => {
      resolveCount += 1;
      if (resolveCount === 1) {
        return "codex-thread-1";
      }
      await new Promise<void>((resolve) => {
        resolveThread = resolve;
      });
      return "codex-thread-1";
    },
  });
  await fixture.service.handle(menuEvent);

  const first = fixture.service.handle(submitEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    await fixture.service.handle({ ...submitEvent, event_id: "evt_submit_2" }),
    "ignored_stale_panel",
  );

  resolveThread();
  assert.equal(await first, "delivered");
  assert.equal(fixture.deliveries.length, 1);
});

test("refresh action sends a new panel and expired panels fail closed", async () => {
  const fixture = createFixture();
  await fixture.service.handle(menuEvent);
  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_refresh",
      action_name: "kanban_refresh",
      form_value: "",
      action_value: JSON.stringify({
        action: "kanban_refresh",
        panelId: "panel-1",
      }),
    }),
    "panel_sent",
  );
  assert.equal(fixture.cards.length, 2);
  assert.equal(fixture.cards[1]?.panelId, "panel-2");

  const expired = createFixture();
  await expired.service.handle(menuEvent);
  expired.advanceMs(16 * 60 * 1_000);
  assert.equal(await expired.service.handle(submitEvent), "ignored_expired");
});

test("a submitted panel can still refresh its list without resending the command", async () => {
  const fixture = createFixture();
  await fixture.service.handle(menuEvent);
  await fixture.service.handle(submitEvent);
  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_refresh_after_submit",
      action_value: JSON.stringify({
        action: "kanban_refresh",
        panelId: "panel-1",
      }),
    }),
    "panel_sent",
  );
  assert.equal(fixture.deliveries.length, 1);
});

test("pages large live Codex lists instead of permanently truncating them", async () => {
  const sessions = Array.from({ length: 55 }, (_, index) => ({
    ...codexSession,
    id: `session-${index + 1}`,
    displayName: `codex-${index + 1}`,
  }));
  const fixture = createFixture({ sessions });

  assert.equal(await fixture.service.handle(menuEvent), "panel_sent");
  assert.equal(fixture.cards[0]?.options.length, 50);
  assert.equal(fixture.cards[0]?.page, 1);
  assert.equal(fixture.cards[0]?.pageCount, 2);
  assert.equal(fixture.cards[0]?.truncated, true);
  assert.equal(fixture.cards[0]?.hasNextPage, true);

  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_page_2",
      action_name: "kanban_page",
      form_value: "",
      action_value: JSON.stringify({
        action: "kanban_page",
        panelId: "panel-1",
        page: 2,
      }),
    }),
    "panel_sent",
  );
  assert.equal(fixture.cards[1]?.options.length, 5);
  assert.equal(fixture.cards[1]?.page, 2);
  assert.equal(fixture.cards[1]?.truncated, true);
  assert.equal(fixture.cards[1]?.hasPreviousPage, true);
});

test("keeps messenger idempotency keys bounded and acknowledges trusted submits", async () => {
  const fixture = createFixture();
  await fixture.service.handle({
    ...menuEvent,
    event_id: `evt_${"x".repeat(200)}`,
  });
  assert.equal(
    fixture.sentCards.every((call) => call.idempotencyKey.length <= 50),
    true,
  );

  assert.equal(await fixture.service.handle(submitEvent), "delivered");
  assert.equal(fixture.sentTexts.length, 1);
  assert.equal(fixture.sentTexts[0]?.chatId, "oc_private");
  assert.equal(fixture.sentTexts[0]?.text, "已发送到 coding-kanban。");
  assert.ok((fixture.sentTexts[0]?.idempotencyKey.length ?? 0) <= 50);
});

test("rechecks settings and session availability after resolving the Codex thread", async () => {
  let resolveCount = 0;
  let fixture = createFixture({
    resolveSessionId: async () => {
      resolveCount += 1;
      if (resolveCount === 2) {
        fixture.setSettings({ ...baseSettings, replyEnabled: false });
      }
      return "codex-thread-1";
    },
  });
  await fixture.service.handle(menuEvent);
  assert.equal(await fixture.service.handle(submitEvent), "ignored_disabled");
  assert.deepEqual(fixture.deliveries, []);

  resolveCount = 0;
  fixture = createFixture({
    resolveSessionId: async () => {
      resolveCount += 1;
      if (resolveCount === 2) {
        fixture.setSessions([{ ...codexSession, controlMode: "observe" }]);
      }
      return "codex-thread-1";
    },
  });
  await fixture.service.handle(menuEvent);
  assert.equal(
    await fixture.service.handle({ ...submitEvent, event_id: "evt_recheck" }),
    "ignored_unavailable",
  );
  assert.deepEqual(fixture.deliveries, []);
});

test("marks uncertain terminal delivery as single-use and does not retry from the same panel", async () => {
  const fixture = createFixture({
    sendText: async () => {
      throw new Error("queue failed after handoff");
    },
  });
  await fixture.service.handle(menuEvent);

  assert.equal(await fixture.service.handle(submitEvent), "delivery_uncertain");
  assert.equal(fixture.deliveries.length, 1);
  assert.equal(
    fixture.sentTexts.at(-1)?.text,
    "提交结果不确定，请核实；不会自动重试。",
  );

  assert.equal(await fixture.service.handle(submitEvent), "ignored_duplicate");
  assert.equal(
    await fixture.service.handle({ ...submitEvent, event_id: "evt_retry" }),
    "ignored_stale_panel",
  );
  assert.equal(fixture.deliveries.length, 1);
});

test("ignores disabled settings, non-menu event keys, and invalid prompt bodies", async () => {
  assert.equal(
    await createFixture({
      settings: { ...baseSettings, replyEnabled: false },
    }).service.handle(menuEvent),
    "ignored_disabled",
  );

  assert.equal(
    await createFixture().service.handle({
      ...menuEvent,
      event_key: "other",
    }),
    "ignored_untrusted",
  );

  const fixture = createFixture();
  await fixture.service.handle(menuEvent);
  assert.equal(
    await fixture.service.handle({
      ...submitEvent,
      event_id: "evt_invalid_prompt",
      form_value: JSON.stringify({ target: "target-1", prompt: "\u001b" }),
    }),
    "ignored_invalid_input",
  );
});
