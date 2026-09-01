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
      createdAt: now.toISOString(),
    });
    assert.equal(statSync(statePath).mode & 0o777, 0o600);

    const reloaded = new FeishuReplyBindingStore({
      statePath,
      now: () => now,
    });
    assert.equal(reloaded.resolve("om_part1")?.sessionId, "session-1");
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
    assert.equal(store.hasProcessed("om_reply"), false);
    store.markProcessed("om_reply");
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
