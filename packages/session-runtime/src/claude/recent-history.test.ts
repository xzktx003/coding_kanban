import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeHistory, type historyCall } from "./history.js";
import { RECENT_HISTORY_PAGE_BYTES } from "../core/recent-history.js";

test("CC recent pages are bounded, chronological, genuinely pageable and metadata probes never ask the SDK for message bodies", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-recent-"));
  await mkdir(join(home, ".claude/projects/p"), { recursive: true });
  await writeFile(join(home, ".claude/projects/p/session.jsonl"), "metadata");
  let reads = 0;
  const rows = Array.from({ length: 600 }, (_, i) => ({
    type: i % 2 ? "assistant" : "user",
    uuid: `m-${i}`,
    session_id: "session",
    message: {
      role: i % 2 ? "assistant" : "user",
      content: [{ type: "text", text: `message-${i} ` + "x".repeat(10_000) }],
    },
  }));
  const call = (async (method) => {
    if (method === "listSessions")
      return [
        {
          sessionId: "session",
          summary: "fixture",
          lastModified: 1,
          fileSize: 100,
          cwd: home,
        },
      ];
    assert.equal(method, "getSessionMessages");
    reads++;
    return rows;
  }) as typeof historyCall;
  const history = new ClaudeHistory(home, { HOME: home }, { call });
  try {
    const metadata = await history.recentMessages("session", {
      metadataOnly: true,
    });
    assert.equal(reads, 0);
    assert.deepEqual(metadata.data, []);
    const page = await history.recentMessages("session", { limit: 256 });
    assert.ok(
      Buffer.byteLength(JSON.stringify(page)) < RECENT_HISTORY_PAGE_BYTES,
    );
    assert.equal((page.data.at(-1) as any).uuid, "m-599");
    assert.ok(page.nextCursor);
    const all: string[][] = [page.data.map((row) => String(row.uuid))];
    let cursor: string | null = page.nextCursor;
    while (cursor) {
      const older = await history.recentMessages("session", {
        cursor,
        limit: 256,
      });
      all.unshift(older.data.map((row) => String(row.uuid)));
      cursor = older.nextCursor;
    }
    assert.deepEqual(
      all.flat(),
      rows.map((row) => row.uuid),
    );
    await assert.rejects(
      history.recentMessages("other", { cursor: page.nextCursor! }),
      /does not belong/,
    );
    const before = reads;
    await history.recentMessages("session", { metadataOnly: true });
    assert.equal(reads, before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("CC oversized tool preview is explicitly marked and can be read through bounded readonly details", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-detail-"));
  const row = {
    type: "assistant",
    uuid: "long",
    session_id: "session",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "long reply " + "answer".repeat(600_000) },
      ],
    },
  };
  const call = (async (method) =>
    method === "listSessions" ? [] : [row]) as typeof historyCall;
  const history = new ClaudeHistory(home, { HOME: home }, { call });
  try {
    const page = await history.recentMessages("session");
    assert.equal(page.truncated, true);
    assert.equal(page.data[0].uuid, "long");
    assert.ok(
      Buffer.byteLength(JSON.stringify(page)) < RECENT_HISTORY_PAGE_BYTES,
    );
    assert.deepEqual(page.data[0].historyDetail, { itemId: "long" });
    const detail = await history.messageDetail("session", "long", {
      offset: 0,
      limit: 65536,
    });
    assert.match(detail.text, /long reply/);
    assert.ok(detail.nextOffset);
    assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 65536);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
