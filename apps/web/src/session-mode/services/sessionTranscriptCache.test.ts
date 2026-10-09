import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  readTranscriptCache,
  writeTranscriptCache,
  saveReadingPosition,
  getReadingPosition,
} from "./sessionTranscriptCache";
import { invalidateTranscriptCache } from "./sessionCacheState";
it("does not restore or persist hidden output payloads alongside the final result", async () => {
  await writeTranscriptCache({
    key: "codex:hidden-output",
    savedAt: Date.now(),
    events: [
      {
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "hidden-output",
          turnId: "t",
          itemId: "cmd",
          delta: "old hidden output",
        },
      } as any,
      {
        method: "item/completed",
        params: {
          threadId: "hidden-output",
          turnId: "t",
          item: {
            type: "commandExecution",
            id: "cmd",
            aggregatedOutput: "complete output",
          },
        },
      } as any,
    ],
  });
  const cached = await readTranscriptCache("codex:hidden-output");
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item.aggregatedOutput).toBe(
    "complete output",
  );
});
it("filters hidden payloads from records written by an older client", async () => {
  const events = [
    ...[
      "rawResponseItem/completed",
      "item/fileChange/outputDelta",
      "item/commandExecution/outputDelta",
    ].map((method) => ({
      method,
      params: {
        threadId: "legacy-output",
        turnId: "t",
        itemId: "cmd",
        delta: "legacy hidden output",
      },
    })),
    {
      method: "item/completed",
      params: {
        threadId: "legacy-output",
        turnId: "t",
        item: {
          type: "agentMessage",
          id: "reply",
          text: "complete visible reply",
        },
      },
    },
  ];
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("kanban.session.transcripts.v1", 2);
    request.onupgradeneeded = () => {
      for (const name of ["transcripts", "budget"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("transcripts", "readwrite");
      tx.objectStore("transcripts").put({
        key: "codex:legacy-output",
        savedAt: Date.now(),
        events,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
  const cached = await readTranscriptCache("codex:legacy-output");
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item.text).toBe(
    "complete visible reply",
  );
});
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
