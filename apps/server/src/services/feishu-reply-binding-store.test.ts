import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FeishuReplyBindingStore } from "./feishu-reply-binding-store.js";

test("persists every notification part as a private reply binding", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-replies-"));
  const statePath = join(directory, "reply-bindings.json");
  const now = new Date("2026-09-01T12:00:00.000Z");

  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "session-1",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      referencedFiles: [{ path: "src/app.ts", line: 12 }],
      messages: [
        { messageId: "om_part1", chatId: "oc_private" },
        { messageId: "om_part2", chatId: "oc_private" },
      ],
    });

    assert.deepEqual(store.resolve("om_part2"), {
      messageId: "om_part2",
      chatId: "oc_private",
      sessionId: "session-1",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      referencedFiles: [{ path: "src/app.ts", line: 12 }],
      createdAt: now.toISOString(),
    });
    assert.equal(statSync(statePath).mode & 0o777, 0o600);

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    assert.equal(reloaded.resolve("om_part1")?.sessionId, "session-1");
    assert.equal(
      reloaded.resolve("om_part1")?.codexThreadId,
      "codex-thread-12345678",
    );
    assert.deepEqual(reloaded.resolve("om_part1")?.referencedFiles, [
      { path: "src/app.ts", line: 12 },
    ]);
    assert.equal(
      JSON.parse(readFileSync(statePath, "utf8")).bindings.length,
      2,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("expires old bindings and persists processed inbound message ids", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-replies-"));
  const statePath = join(directory, "reply-bindings.json");
  let now = new Date("2026-09-01T12:00:00.000Z");

  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      ttlMs: 1_000,
      now: () => now,
    });
    store.record({
      sessionId: "session-1",
      completionId: "turn-1",
      messages: [{ messageId: "om_notice", chatId: "oc_private" }],
    });
    const parent = store.resolve("om_notice");
    assert.ok(parent);
    assert.equal(store.hasProcessed("om_reply"), false);
    store.recordProcessedReply({
      messageId: "om_reply",
      parent,
      codexThreadId: "codex-thread-12345678",
    });
    assert.equal(store.hasProcessed("om_reply"), true);

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      ttlMs: 1_000,
      now: () => now,
    });
    assert.equal(reloaded.hasProcessed("om_reply"), true);

    now = new Date("2026-09-01T12:00:02.000Z");
    assert.equal(reloaded.resolve("om_notice"), null);
    assert.equal(reloaded.hasProcessed("om_reply"), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("persists Claude transcript targets without using codex reply routing ids", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-replies-"));
  const statePath = join(directory, "reply-bindings.json");
  const now = new Date("2026-09-01T12:00:00.000Z");
  const claudeSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "session-claude",
      completionId: "claude-turn-1",
      codexThreadId: claudeSessionId,
      transcriptAgentKind: "claude",
      transcriptSessionId: claudeSessionId,
      messages: [{ messageId: "om_claude", chatId: "oc_private" }],
    });

    assert.deepEqual(store.resolve("om_claude"), {
      messageId: "om_claude",
      chatId: "oc_private",
      sessionId: "session-claude",
      completionId: "claude-turn-1",
      transcriptAgentKind: "claude",
      transcriptSessionId: claudeSessionId,
      createdAt: now.toISOString(),
    });

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    assert.equal(reloaded.resolve("om_claude")?.codexThreadId, undefined);
    assert.equal(
      reloaded.resolve("om_claude")?.transcriptSessionId,
      claudeSessionId,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("atomically persists a delivered reply as the next reply binding", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-replies-"));
  const statePath = join(directory, "reply-bindings.json");
  const now = new Date("2026-09-01T12:00:00.000Z");

  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "session-1",
      completionId: "turn-1",
      messages: [{ messageId: "om_notice", chatId: "oc_private" }],
    });
    const parent = store.resolve("om_notice");
    assert.ok(parent);

    store.recordProcessedReply({
      messageId: "om_reply",
      parent,
      codexThreadId: "codex-thread-12345678",
    });

    assert.equal(store.hasProcessed("om_reply"), true);
    assert.deepEqual(store.resolve("om_reply"), {
      messageId: "om_reply",
      chatId: "oc_private",
      sessionId: "session-1",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      createdAt: now.toISOString(),
    });

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    assert.equal(reloaded.hasProcessed("om_reply"), true);
    assert.equal(reloaded.resolve("om_reply")?.sessionId, "session-1");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("persists trusted absolute references and drops unsafe absolute paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-replies-"));
  const statePath = join(directory, "reply-bindings.json");
  const now = new Date("2026-09-01T12:00:00.000Z");

  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "session-1",
      completionId: "turn-absolute",
      codexThreadId: "codex-thread-12345678",
      referencedFiles: [
        { path: "/data/work/out.pdf", line: 4 },
        { path: "/data/work/../../etc/passwd" },
        { path: "/data/work/.env" },
        { path: "/data/work/id_rsa" },
        { path: "src/app.ts" },
      ],
      messages: [{ messageId: "om_absolute", chatId: "oc_private" }],
    });

    assert.deepEqual(store.resolve("om_absolute")?.referencedFiles, [
      { path: "/data/work/out.pdf", line: 4 },
      { path: "src/app.ts" },
    ]);
    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    assert.deepEqual(reloaded.resolve("om_absolute")?.referencedFiles, [
      { path: "/data/work/out.pdf", line: 4 },
      { path: "src/app.ts" },
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("native session binding survives disk reload and reply chains without terminal thread actions", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-native-bindings-"));
  const statePath = join(directory, "bindings.json");
  try {
    const store = new FeishuReplyBindingStore({ statePath });
    store.record({
      sessionId: "session-codex:native-thread",
      sessionModeThreadId: "native-thread",
      completionId: "turn-1",
      messages: [{ messageId: "om_native", chatId: "oc_private" }],
    });
    const reloaded = new FeishuReplyBindingStore({ statePath });
    const parent = reloaded.resolve("om_native")!;
    assert.equal(parent.sessionModeThreadId, "native-thread");
    assert.equal(parent.codexThreadId, undefined);
    reloaded.recordProcessedReply({
      messageId: "om_reply",
      parent,
      codexThreadId: "native-thread",
    });
    const again = new FeishuReplyBindingStore({ statePath });
    assert.equal(
      again.resolve("om_reply")?.sessionModeThreadId,
      "native-thread",
    );
    assert.equal(again.resolve("om_reply")?.codexThreadId, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("finds persisted Codex completion deliveries by native thread and turn", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-codex-delivery-"));
  const statePath = join(directory, "bindings.json");
  const now = new Date("2026-10-10T10:00:00.000Z");
  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "session-codex:native-thread",
      sessionModeThreadId: "native-thread",
      completionId: "turn-1",
      referencedFiles: [{ path: "src/app.ts", line: 12 }],
      messages: [
        { messageId: "om_part_b", chatId: "oc_private" },
        { messageId: "om_part_a", chatId: "oc_private" },
      ],
    });

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });

    assert.deepEqual(
      reloaded.findCodexCompletionDelivery("native-thread", "turn-1"),
      {
        messages: [
          { messageId: "om_part_a", chatId: "oc_private" },
          { messageId: "om_part_b", chatId: "oc_private" },
        ],
        referencedFiles: [{ path: "src/app.ts", line: 12 }],
      },
    );
    assert.equal(
      reloaded.findCodexCompletionDelivery("native-thread", "turn-2"),
      undefined,
    );
    assert.equal(
      reloaded.findCodexCompletionDelivery("other-thread", "turn-1"),
      undefined,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("finds Codex transcript deliveries and excludes processed reply messages", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-codex-transcript-"));
  const statePath = join(directory, "bindings.json");
  try {
    const store = new FeishuReplyBindingStore({ statePath });
    store.record({
      sessionId: "terminal-session",
      completionId: "turn-1",
      transcriptAgentKind: "codex",
      transcriptSessionId: "codex-thread-12345678",
      messages: [{ messageId: "om_notice", chatId: "oc_private" }],
    });
    const parent = store.resolve("om_notice");
    assert.ok(parent);
    store.recordProcessedReply({
      messageId: "om_reply",
      parent,
      codexThreadId: "codex-thread-12345678",
    });

    assert.deepEqual(
      store.findCodexCompletionDelivery("codex-thread-12345678", "turn-1"),
      {
        messages: [{ messageId: "om_notice", chatId: "oc_private" }],
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expires persisted Codex completion lookup entries with the binding TTL", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-codex-delivery-ttl-"));
  const statePath = join(directory, "bindings.json");
  let now = new Date("2026-10-10T10:00:00.000Z");
  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      ttlMs: 1_000,
      now: () => now,
    });
    store.record({
      sessionId: "terminal-session",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      messages: [{ messageId: "om_notice", chatId: "oc_private" }],
    });
    assert.ok(
      store.findCodexCompletionDelivery("codex-thread-12345678", "turn-1"),
    );

    now = new Date("2026-10-10T10:00:02.000Z");

    assert.equal(
      store.findCodexCompletionDelivery("codex-thread-12345678", "turn-1"),
      undefined,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps native reply routing when terminal and native record the same delivery", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-codex-native-route-"));
  const statePath = join(directory, "bindings.json");
  const messages = [
    { messageId: "om_shared_a", chatId: "oc_private" },
    { messageId: "om_shared_b", chatId: "oc_private" },
  ];
  try {
    for (const order of ["native-first", "terminal-first"]) {
      rmSync(statePath, { force: true });
      const store = new FeishuReplyBindingStore({ statePath });
      const nativeInput = {
        sessionId: "session-codex:native-thread",
        sessionModeThreadId: "native-thread",
        completionId: "turn-1",
        messages,
      };
      const terminalInput = {
        sessionId: "terminal-session",
        completionId: "turn-1",
        codexThreadId: "native-thread",
        messages,
      };
      if (order === "native-first") {
        store.record(nativeInput);
        store.record(terminalInput);
      } else {
        store.record(terminalInput);
        store.record(nativeInput);
      }

      const first = store.resolve("om_shared_a");
      const second = store.resolve("om_shared_b");
      assert.equal(first?.sessionModeThreadId, "native-thread");
      assert.equal(second?.sessionModeThreadId, "native-thread");
      assert.equal(first?.sessionId, "session-codex:native-thread");
      assert.equal(second?.codexThreadId, undefined);
      assert.deepEqual(
        store.findCodexCompletionDelivery("native-thread", "turn-1"),
        { messages },
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("selects one latest legacy delivery group without mixing historical duplicates", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanban-codex-legacy-group-"));
  const statePath = join(directory, "bindings.json");
  let now = new Date("2026-10-10T10:00:00.000Z");
  try {
    const store = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    store.record({
      sessionId: "terminal-old",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      messages: [
        { messageId: "om_old_a", chatId: "oc_private" },
        { messageId: "om_old_b", chatId: "oc_private" },
      ],
    });
    now = new Date("2026-10-10T10:00:01.000Z");
    store.record({
      sessionId: "terminal-new",
      completionId: "turn-1",
      codexThreadId: "codex-thread-12345678",
      messages: [{ messageId: "om_new", chatId: "oc_private" }],
    });

    assert.deepEqual(
      store.findCodexCompletionDelivery("codex-thread-12345678", "turn-1"),
      {
        messages: [{ messageId: "om_new", chatId: "oc_private" }],
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
