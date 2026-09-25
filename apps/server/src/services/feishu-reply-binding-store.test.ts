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
