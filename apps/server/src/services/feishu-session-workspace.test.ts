import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  AgentTranscriptResponse,
  FeishuNotificationSettingsResponse,
} from "@agent-orchestrator/shared";

import {
  FeishuSessionWorkspace,
  type FeishuWorkspaceCardActionEvent,
  type FeishuWorkspaceFileEntry,
} from "./feishu-session-workspace.js";

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
  hostId: "local",
  sourceType: "local",
  agentKind: "codex",
  displayName: "coding-kanban",
  workingDirectory: "/repo/coding-kanban",
  connectionState: "online",
  interactionState: "idle",
  controlMode: "control",
  transportRef: { tmuxSession: "coding-kanban", tmuxPane: "%1" },
};

const transcriptPage: AgentTranscriptResponse = {
  available: true,
  agentKind: "codex",
  sessionId: "thread-1",
  matchedBy: "session-id",
  updatedAt: "2026-09-09T08:00:00.000Z",
  hasMore: true,
  nextCursor: "older",
  entries: [
    {
      id: "tool-1",
      timestamp: "2026-09-09T07:59:00.000Z",
      kind: "tool",
      title: "shell",
      text: "pnpm test",
      collapsedByDefault: false,
    },
    {
      id: "user-1",
      timestamp: "2026-09-09T08:00:00.000Z",
      kind: "user",
      title: "用户",
      text: "帮我看文件",
      collapsedByDefault: false,
    },
    {
      id: "assistant-1",
      timestamp: "2026-09-09T08:01:00.000Z",
      kind: "assistant",
      title: "Codex",
      text: "可以，我会检查。",
      collapsedByDefault: false,
    },
    {
      id: "internal-1",
      timestamp: "2026-09-09T08:02:00.000Z",
      kind: "assistant",
      title: "goal.internal_context",
      text: "internal context",
      collapsedByDefault: false,
    } as AgentTranscriptResponse["entries"][number] & { internal: true },
  ],
};

function createEvent(
  fixture: ReturnType<typeof createFixture>,
  token: string,
  eventId: string,
  overrides: Partial<FeishuWorkspaceCardActionEvent> = {},
): FeishuWorkspaceCardActionEvent {
  return {
    type: "card.action.trigger",
    event_id: eventId,
    operator_id: "ou_owner",
    message_id: fixture.lastMessageId(),
    chat_id: "oc_private",
    action_tag: "button",
    action_value: JSON.stringify({
      action: "kanban_workspace_",
      token,
    }),
    ...overrides,
  };
}

function tokenFor(card: unknown, text: string): string {
  let token: string | null = null;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || token) return;
    const record = value as Record<string, unknown>;
    const buttonText = record.text as { content?: string } | undefined;
    if (record.tag === "button" && buttonText?.content?.includes(text)) {
      const behavior = (
        record.behaviors as Array<{ value?: { token?: string } }> | undefined
      )?.[0];
      token = behavior?.value?.token ?? null;
      return;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  }
  visit(card);
  assert.equal(typeof token, "string", `missing button token for ${text}`);
  if (token === null) {
    throw new Error(`missing button token for ${text}`);
  }
  return token;
}

function formTokenFor(card: unknown): string {
  let token: string | null = null;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || token) return;
    const record = value as Record<string, unknown>;
    if (
      record.tag === "button" &&
      typeof record.name === "string" &&
      record.name.startsWith("kanban_workspace_form_")
    ) {
      token = record.name.slice("kanban_workspace_form_".length);
      return;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  }
  visit(card);
  assert.equal(typeof token, "string", "missing form submit token");
  if (token === null) {
    throw new Error("missing form submit token");
  }
  return token;
}

function createFixture(
  overrides: {
    settings?: FeishuNotificationSettingsResponse;
    session?: AgentSessionRecord;
    threadId?: string;
    nowMs?: number;
    transcript?: AgentTranscriptResponse;
    listEntries?: FeishuWorkspaceFileEntry[];
    readContent?: string;
    readRevision?: string;
    readEditable?: boolean;
    read?: (
      path: string,
    ) => Promise<{ content: string; revision: string; editable: boolean }>;
    resolveSessionId?: () => Promise<string | undefined>;
    notificationBinding?: {
      messageId: string;
      chatId: string;
      sessionId: string;
      codexThreadId?: string;
    } | null;
    sendCard?: (
      input: {
        card: unknown;
        idempotencyKey: string;
        chatId?: string;
        userId?: string;
      },
      defaultSend: (input: {
        card: unknown;
        idempotencyKey: string;
        chatId?: string;
        userId?: string;
      }) => Promise<{ messageId: string; chatId: string }>,
    ) => Promise<{ messageId: string; chatId: string }>;
    write?: (
      path: string,
      content: string,
      expectedRevision: string | null,
    ) => Promise<void>;
  } = {},
) {
  let settings = overrides.settings ?? baseSettings;
  let session = overrides.session ?? codexSession;
  let threadId = overrides.threadId ?? "thread-1";
  let nowMs = overrides.nowMs ?? 1_000;
  let messageCounter = 0;
  const ids = Array.from({ length: 200 }, (_, index) => `id-${index + 1}`);
  const sentCards: Array<{
    card: unknown;
    idempotencyKey: string;
    chatId?: string;
    userId?: string;
  }> = [];
  const sentTexts: Array<{
    chatId: string;
    text: string;
    idempotencyKey: string;
  }> = [];
  const sentFiles: Array<{
    name: string;
    data: Buffer;
    idempotencyKey: string;
  }> = [];
  const writes: Array<{
    path: string;
    content: string;
    expectedRevision: string | null;
  }> = [];
  const transcriptCalls: Array<{ cursor?: string }> = [];
  const service = new FeishuSessionWorkspace({
    allowedUserId: "ou_owner",
    now: () => nowMs,
    createId: () => ids.shift() ?? `id-extra-${ids.length}`,
    settings: { get: () => settings },
    registry: {
      get: (sessionId) => {
        if (sessionId !== session.id) {
          throw new Error("missing");
        }
        return session;
      },
    },
    resolveSessionId: async () => overrides.resolveSessionId?.() ?? threadId,
    notificationBindings: {
      resolve: () => overrides.notificationBinding ?? null,
    },
    files: {
      list: async () => ({
        entries: overrides.listEntries ?? [
          { name: "src", path: "src", type: "directory", size: 0 },
          { name: "README.md", path: "README.md", type: "file", size: 20 },
        ],
        truncated: false,
      }),
      read: async (_session, path) =>
        overrides.read?.(path) ?? {
          content: overrides.readContent ?? `content of ${path}`,
          revision: overrides.readRevision ?? "rev-1",
          editable: overrides.readEditable ?? true,
        },
      write: async (_session, path, content, expectedRevision) => {
        writes.push({ path, content, expectedRevision });
        await overrides.write?.(path, content, expectedRevision);
      },
      download: async (_session, path) => ({
        name: path.split("/").at(-1) ?? "download.txt",
        data: Buffer.from(`download:${path}`),
      }),
    },
    transcript: async (_session, _threadId, cursor) => {
      transcriptCalls.push({ cursor });
      return overrides.transcript ?? transcriptPage;
    },
    exportTranscript: async () => ({
      name: "coding-kanban.md",
      data: Buffer.from("full transcript"),
    }),
    messenger: {
      sendCard: async (input) => {
        const defaultSend = async (cardInput: typeof input) => {
          sentCards.push(cardInput);
          messageCounter += 1;
          return {
            messageId: `om_card_${messageCounter}`,
            chatId: cardInput.chatId ?? "oc_private",
          };
        };
        if (overrides.sendCard) {
          return overrides.sendCard(input, defaultSend);
        }
        return defaultSend(input);
      },
      sendText: async (input) => {
        sentTexts.push(input);
      },
      sendFile: async (input) => {
        sentFiles.push(input);
      },
    },
  });

  return {
    service,
    sentCards,
    sentTexts,
    sentFiles,
    writes,
    transcriptCalls,
    lastMessageId: () => `om_card_${messageCounter}`,
    lastCard: () => sentCards.at(-1)?.card,
    setSettings: (next: FeishuNotificationSettingsResponse) => {
      settings = next;
    },
    setSession: (next: AgentSessionRecord) => {
      session = next;
    },
    setThreadId: (next: string) => {
      threadId = next;
    },
    advanceMs: (delta: number) => {
      nowMs += delta;
    },
  };
}

test("notification records callback opens only its bound current Codex transcript", async () => {
  const fixture = createFixture({
    notificationBinding: {
      messageId: "om_notice",
      chatId: "oc_private",
      sessionId: "session-1",
      codexThreadId: "thread-1",
    },
  });
  const event = {
    type: "card.action.trigger",
    event_id: "evt_notice_records",
    operator_id: "ou_owner",
    message_id: "om_notice",
    chat_id: "oc_private",
    action_tag: "button",
    action_value: JSON.stringify({ action: "kanban_completion_records" }),
  };
  assert.equal(fixture.service.accepts(event), true);
  assert.equal(await fixture.service.handle(event), "records_sent");
  assert.deepEqual(fixture.transcriptCalls, [{ cursor: undefined }]);
  assert.match(JSON.stringify(fixture.lastCard()), /帮我看文件/);

  assert.equal(
    await fixture.service.handle({
      ...event,
      event_id: "evt_notice_forged",
      chat_id: "oc_forged",
    }),
    "ignored_untrusted",
  );
});

test("opens a trusted per-session workspace card with records files and refresh actions", async () => {
  const fixture = createFixture();

  assert.equal(
    await fixture.service.open({
      sessionId: "session-1",
      threadId: "thread-1",
      operatorId: "ou_owner",
      chatId: "oc_private",
    }),
    "workspace_sent",
  );

  assert.equal(fixture.sentCards.length, 1);
  assert.match(JSON.stringify(fixture.lastCard()), /会话工作区/);
  assert.equal(typeof tokenFor(fixture.lastCard(), "查看完整记录"), "string");
  assert.equal(typeof tokenFor(fixture.lastCard(), "浏览项目文件"), "string");
});

test("remote sessions can inspect status and records but do not expose file browsing", async () => {
  const fixture = createFixture({
    session: {
      ...codexSession,
      hostId: "gpu",
      sourceType: "remote-tmux-discovered",
      sshTarget: { host: "10.0.0.2", username: "dev" },
    },
  });

  assert.equal(
    await fixture.service.open({
      sessionId: "session-1",
      threadId: "thread-1",
      operatorId: "ou_owner",
      chatId: "oc_private",
    }),
    "workspace_sent",
  );

  const json = JSON.stringify(fixture.lastCard());
  assert.match(json, /SSH 状态和记录可查看/);
  assert.doesNotMatch(json, /浏览项目文件/);
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "查看完整记录"),
        "evt_remote_records",
      ),
    ),
    "records_sent",
  );
});

test("rejects untrusted users and stale card provenance before touching files or transcript", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const token = tokenFor(fixture.lastCard(), "浏览项目文件");

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, token, "evt_other_user", {
        operator_id: "ou_other",
      }),
    ),
    "ignored_untrusted",
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, token, "evt_wrong_card", { message_id: "om_other" }),
    ),
    "ignored_stale_workspace",
  );
  assert.equal(fixture.sentCards.length, 1);
  assert.equal(fixture.transcriptCalls.length, 0);
});

test("expires workspace actions closed and deduplicates repeated callbacks", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const token = tokenFor(fixture.lastCard(), "浏览项目文件");

  assert.equal(
    await fixture.service.handle(createEvent(fixture, token, "evt_files")),
    "files_sent",
  );
  assert.equal(
    await fixture.service.handle(createEvent(fixture, token, "evt_files")),
    "ignored_duplicate",
  );

  const expired = createFixture();
  await expired.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const expiredToken = tokenFor(expired.lastCard(), "浏览项目文件");
  expired.advanceMs(16 * 60 * 1_000);
  assert.equal(
    await expired.service.handle(
      createEvent(expired, expiredToken, "evt_expired"),
    ),
    "ignored_expired",
  );
});

test("rechecks exact thread and workspace signature before sending action results", async () => {
  const changedThread = createFixture();
  await changedThread.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const filesToken = tokenFor(changedThread.lastCard(), "浏览项目文件");
  changedThread.setThreadId("thread-2");

  assert.equal(
    await changedThread.service.handle(
      createEvent(changedThread, filesToken, "evt_changed_thread"),
    ),
    "ignored_changed_thread",
  );

  const changedRoot = createFixture();
  await changedRoot.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const recordsToken = tokenFor(changedRoot.lastCard(), "查看完整记录");
  changedRoot.setSession({ ...codexSession, workingDirectory: "/repo/other" });

  assert.equal(
    await changedRoot.service.handle(
      createEvent(changedRoot, recordsToken, "evt_changed_root"),
    ),
    "ignored_changed_thread",
  );
});

test("records show only public user and assistant entries and keep cursor server-side", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const token = tokenFor(fixture.lastCard(), "查看完整记录");

  assert.equal(
    await fixture.service.handle(createEvent(fixture, token, "evt_records")),
    "records_sent",
  );

  const json = JSON.stringify(fixture.lastCard());
  assert.match(json, /帮我看文件/);
  assert.match(json, /可以，我会检查/);
  assert.doesNotMatch(json, /pnpm test/);
  assert.doesNotMatch(json, /goal\.internal_context/);
  const olderToken = tokenFor(fixture.lastCard(), "更早记录");
  assert.equal(
    await fixture.service.handle(createEvent(fixture, olderToken, "evt_older")),
    "records_sent",
  );
  assert.deepEqual(
    fixture.transcriptCalls.map((call) => call.cursor),
    [undefined, "older"],
  );
});

test("exports transcript and downloads files via messenger sendFile", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "查看完整记录"),
      "evt_records",
    ),
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "导出完整记录"),
        "evt_export",
      ),
    ),
    "export_sent",
  );

  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "返回工作区"),
      "evt_home",
    ),
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "下载 · README.md"),
        "evt_direct_download",
      ),
    ),
    "download_sent",
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "预览文件 · README.md"),
      "evt_view",
    ),
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "下载文件"),
        "evt_download",
      ),
    ),
    "download_sent",
  );

  assert.deepEqual(
    fixture.sentFiles.map((file) => [file.name, file.data.toString("utf8")]),
    [
      ["coding-kanban.md", "full transcript"],
      ["README.md", "download:README.md"],
      ["README.md", "download:README.md"],
    ],
  );
});

test("preview failures still return a bounded download card", async () => {
  const fixture = createFixture({
    read: async () => {
      throw new Error("too large with /secret/path");
    },
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );

  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "预览文件 · README.md"),
        "evt_preview_failed",
      ),
    ),
    "file_sent",
  );
  const json = JSON.stringify(fixture.lastCard());
  assert.match(json, /无法作为 128KiB 内 UTF-8 文本预览/);
  assert.doesNotMatch(json, /secret\/path/);
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "下载文件"),
        "evt_download_failed_preview",
      ),
    ),
    "download_sent",
  );
});

test("successful reads do not mask preview card delivery failures as preview unavailable", async () => {
  let sendCount = 0;
  const fixture = createFixture({
    sendCard: async (input, defaultSend) => {
      sendCount += 1;
      if (sendCount === 3) {
        throw new Error("card delivery failed");
      }
      return defaultSend(input);
    },
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );

  await assert.rejects(
    () =>
      fixture.service.handle(
        createEvent(
          fixture,
          tokenFor(fixture.lastCard(), "预览文件 · README.md"),
          "evt_preview_send_failed",
        ),
      ),
    /card delivery failed/,
  );
  assert.equal(sendCount, 3);
  assert.doesNotMatch(
    JSON.stringify(fixture.lastCard()),
    /无法作为 128KiB 内 UTF-8 文本预览/,
  );
});

test("lists files with opaque navigation tokens and does not trust callback paths", async () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({
    name: `file-${index + 1}.txt`,
    path: `dir/file-${index + 1}.txt`,
    type: "file" as const,
    size: index,
  }));
  const fixture = createFixture({ listEntries: entries });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );

  assert.match(JSON.stringify(fixture.lastCard()), /第 1 \/ 2 页/);
  const next = tokenFor(fixture.lastCard(), "下一页");
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, next, "evt_page", {
        action_value: JSON.stringify({
          action: "kanban_workspace_",
          token: next,
          path: "../secret",
        }),
      }),
    ),
    "files_sent",
  );
  assert.match(JSON.stringify(fixture.lastCard()), /file-11\.txt/);
});

test("edit submits stage a confirmation card and only confirmation writes stored content", async () => {
  const fixture = createFixture({
    readContent: "old text",
    readRevision: "rev-edit",
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "预览文件 · README.md"),
      "evt_view",
    ),
  );
  await fixture.service.handle(
    createEvent(fixture, tokenFor(fixture.lastCard(), "编辑文件"), "evt_edit"),
  );
  const submitToken = formTokenFor(fixture.lastCard());

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, submitToken, "evt_submit_form", {
        action_name: `kanban_workspace_form_${submitToken}`,
        form_value: JSON.stringify({ content: "new text" }),
      }),
    ),
    "write_confirm_sent",
  );
  assert.deepEqual(fixture.writes, []);

  const confirmToken = tokenFor(fixture.lastCard(), "确认写入");
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, confirmToken, "evt_confirm"),
    ),
    "write_applied",
  );
  assert.deepEqual(fixture.writes, [
    { path: "README.md", content: "new text", expectedRevision: "rev-edit" },
  ]);
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, confirmToken, "evt_confirm_2"),
    ),
    "ignored_stale_workspace",
  );
});

test("new file form validates basename and creates only after confirmation", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  await fixture.service.handle(
    createEvent(fixture, tokenFor(fixture.lastCard(), "新建文件"), "evt_new"),
  );
  const submitToken = formTokenFor(fixture.lastCard());

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, submitToken, "evt_bad_name", {
        action_name: `kanban_workspace_form_${submitToken}`,
        form_value: JSON.stringify({ basename: "../secret", content: "x" }),
      }),
    ),
    "ignored_invalid_input",
  );
  assert.deepEqual(fixture.writes, []);

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, submitToken, "evt_new_submit", {
        action_name: `kanban_workspace_form_${submitToken}`,
        form_value: JSON.stringify({ basename: "note.txt", content: "" }),
      }),
    ),
    "write_confirm_sent",
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(
        fixture,
        tokenFor(fixture.lastCard(), "确认写入"),
        "evt_new_confirm",
      ),
    ),
    "write_applied",
  );
  assert.deepEqual(fixture.writes, [
    { path: "note.txt", content: "", expectedRevision: null },
  ]);
});

test("write conflicts are reported without retrying or applying a second write", async () => {
  const fixture = createFixture({
    write: async () => {
      throw new Error("changed");
    },
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "预览文件 · README.md"),
      "evt_view",
    ),
  );
  await fixture.service.handle(
    createEvent(fixture, tokenFor(fixture.lastCard(), "编辑文件"), "evt_edit"),
  );
  const submitToken = formTokenFor(fixture.lastCard());
  await fixture.service.handle(
    createEvent(fixture, submitToken, "evt_submit", {
      action_name: `kanban_workspace_form_${submitToken}`,
      form_value: JSON.stringify({ content: "new text" }),
    }),
  );
  const confirmToken = tokenFor(fixture.lastCard(), "确认写入");

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, confirmToken, "evt_confirm"),
    ),
    "delivery_uncertain",
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, confirmToken, "evt_confirm_retry"),
    ),
    "ignored_stale_workspace",
  );
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.sentTexts.at(-1)?.text ?? "", /未自动重试/);
});

test("canceling a staged write invalidates the paired confirm token", async () => {
  const fixture = createFixture({
    readContent: "old text",
    readRevision: "rev-edit",
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "预览文件 · README.md"),
      "evt_view",
    ),
  );
  await fixture.service.handle(
    createEvent(fixture, tokenFor(fixture.lastCard(), "编辑文件"), "evt_edit"),
  );
  const submitToken = formTokenFor(fixture.lastCard());
  await fixture.service.handle(
    createEvent(fixture, submitToken, "evt_submit_form", {
      action_name: `kanban_workspace_form_${submitToken}`,
      form_value: JSON.stringify({ content: "new text" }),
    }),
  );
  const confirmToken = tokenFor(fixture.lastCard(), "确认写入");
  const cancelToken = tokenFor(fixture.lastCard(), "取消");

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, cancelToken, "evt_cancel"),
    ),
    "files_sent",
  );
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, confirmToken, "evt_confirm_after_cancel"),
    ),
    "ignored_stale_workspace",
  );
  assert.deepEqual(fixture.writes, []);
});

test("concurrent confirm and cancel events cannot both affect the same staged write", async () => {
  let releaseWrite!: () => void;
  const fixture = createFixture({
    readContent: "old text",
    readRevision: "rev-edit",
    write: async () => {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    },
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "浏览项目文件"),
      "evt_files",
    ),
  );
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "预览文件 · README.md"),
      "evt_view",
    ),
  );
  await fixture.service.handle(
    createEvent(fixture, tokenFor(fixture.lastCard(), "编辑文件"), "evt_edit"),
  );
  const submitToken = formTokenFor(fixture.lastCard());
  await fixture.service.handle(
    createEvent(fixture, submitToken, "evt_submit_form", {
      action_name: `kanban_workspace_form_${submitToken}`,
      form_value: JSON.stringify({ content: "new text" }),
    }),
  );
  const confirmToken = tokenFor(fixture.lastCard(), "确认写入");
  const cancelToken = tokenFor(fixture.lastCard(), "取消");

  const pendingConfirm = fixture.service.handle(
    createEvent(fixture, confirmToken, "evt_confirm"),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, cancelToken, "evt_cancel_race"),
    ),
    "ignored_stale_workspace",
  );
  releaseWrite();
  assert.equal(await pendingConfirm, "write_applied");
  assert.equal(fixture.writes.length, 1);
});

test("tokens from an older workspace card cannot be replayed on the latest card", async () => {
  const fixture = createFixture();
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const oldFilesToken = tokenFor(fixture.lastCard(), "浏览项目文件");
  await fixture.service.handle(
    createEvent(
      fixture,
      tokenFor(fixture.lastCard(), "查看完整记录"),
      "evt_records",
    ),
  );

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, oldFilesToken, "evt_old_token_latest_card"),
    ),
    "ignored_stale_workspace",
  );
  assert.doesNotMatch(JSON.stringify(fixture.lastCard()), /文件浏览/);
});

test("settings disabled during thread resolution abort before sending action results", async () => {
  let resolveCount = 0;
  let fixture!: ReturnType<typeof createFixture>;
  fixture = createFixture({
    resolveSessionId: async () => {
      resolveCount += 1;
      if (resolveCount > 1) {
        fixture.setSettings({ ...baseSettings, replyEnabled: false });
      }
      return "thread-1";
    },
  });
  await fixture.service.open({
    sessionId: "session-1",
    threadId: "thread-1",
    operatorId: "ou_owner",
    chatId: "oc_private",
  });
  const filesToken = tokenFor(fixture.lastCard(), "浏览项目文件");

  assert.equal(
    await fixture.service.handle(
      createEvent(fixture, filesToken, "evt_disabled_during_resolve"),
    ),
    "ignored_disabled",
  );
  assert.equal(fixture.sentCards.length, 1);
});

test("ordinary non-workspace form callbacks do not write", async () => {
  const fixture = createFixture();
  assert.equal(
    await fixture.service.handle({
      type: "card.action.trigger",
      event_id: "evt_plain_form",
      operator_id: "ou_owner",
      message_id: "om_card_1",
      chat_id: "oc_private",
      action_tag: "button",
      action_name: "kanban_submit_panel",
      form_value: JSON.stringify({ content: "x" }),
    }),
    "ignored_untrusted",
  );
  assert.deepEqual(fixture.writes, []);
});
