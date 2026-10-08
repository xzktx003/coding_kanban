import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  readTranscriptCache,
  writeTranscriptCache,
  saveReadingPosition,
  getReadingPosition,
} from "./sessionTranscriptCache";
import { invalidateTranscriptCache } from "./sessionCacheState";
it("restores recent content and a reading anchor without restoring executable requests", async () => {
  await writeTranscriptCache({
    key: "codex:cache-test",
    savedAt: Date.now(),
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "cache-test",
          turnId: "t",
          item: {
            type: "agentMessage",
            id: "a",
            text: "saved reply",
            phase: null,
            memoryCitation: null,
          },
          completedAtMs: 0,
        },
      },
    ],
    cursor: "older",
    thread: {
      id: "cache-test",
      turns: [],
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    } as any,
  });
  const cached = await readTranscriptCache("codex:cache-test");
  expect(cached?.events).toHaveLength(1);
  expect(cached?.thread?.status.type).toBe("notLoaded");
  expect(cached?.cursor).toBe("older");
  saveReadingPosition("codex:cache-test", {
    atBottom: false,
    anchor: "a",
    offset: 14,
    scrollTop: 200,
  });
  expect(getReadingPosition("codex:cache-test")?.anchor).toBe("a");
});
it("rollback invalidation rejects old disk snapshots and late writes", async () => {
  const record = {
    key: "codex:rollback-cache",
    savedAt: Date.now() - 1000,
    events: [],
  };
  await writeTranscriptCache(record);
  invalidateTranscriptCache(record.key);
  expect(await readTranscriptCache(record.key)).toBeUndefined();
  await writeTranscriptCache(record);
  expect(await readTranscriptCache(record.key)).toBeUndefined();
});
it("bounds persisted event data and strips duplicated turn item bodies", async () => {
  const events = Array.from({ length: 1200 }, (_, i) => ({
    method: "turn/completed",
    params: {
      threadId: "large",
      turn: {
        id: String(i),
        items: [{ huge: "x".repeat(1000) }],
        status: "completed",
      },
    },
  })) as any;
  await writeTranscriptCache({
    key: "codex:large",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:large");
  expect(cached!.events!.length).toBeLessThanOrEqual(600);
  expect((cached!.events!.at(-1)!.params as any).turn.items).toEqual([]);
});
