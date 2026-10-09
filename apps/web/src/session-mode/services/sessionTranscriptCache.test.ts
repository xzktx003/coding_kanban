import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  readTranscriptCache,
  writeTranscriptCache,
  saveReadingPosition,
  getReadingPosition,
} from "./sessionTranscriptCache";
import { invalidateTranscriptCache } from "./sessionCacheState";
import type { ServerNotification } from "../bindings";
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

it("precompacts oversized codex tool payloads before serializing cache records", async () => {
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  let largestSerialized = 0;
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    const serialized = originalStringify(value, ...(args as []));
    stringifyCalls += 1;
    largestSerialized = Math.max(largestSerialized, serialized.length);
    return serialized;
  }) as typeof JSON.stringify;
  try {
    const events = Array.from({ length: 120 }, (_, i) => ({
      method: "item/completed",
      params: {
        threadId: "oversized-tool-cache",
        turnId: `turn-${i}`,
        item: {
          type: "commandExecution",
          id: `cmd-${i}`,
          status: "completed",
          aggregatedOutput: `${i}:`.repeat(50_000),
        },
      },
    })) as ServerNotification[];
    await writeTranscriptCache({
      key: "codex:oversized-tool-cache",
      savedAt: Date.now(),
      events,
    });
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(stringifyCalls).toBeLessThanOrEqual(1);
  expect(largestSerialized).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:oversized-tool-cache");
  expect(cached?.events?.length).toBeGreaterThan(0);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("persists a reduced event window after estimate-based cache trimming", async () => {
  const events = Array.from({ length: 900 }, (_, i) => ({
    method: "item/completed",
    params: {
      threadId: "estimated-window-cache",
      turnId: `turn-${i}`,
      item: {
        type: "agentMessage",
        id: `reply-${i}`,
        text: `${i}:`.repeat(2_000),
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: "codex:estimated-window-cache",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:estimated-window-cache");
  expect(cached?.events?.length).toBeGreaterThan(0);
  expect(cached?.events?.length).toBeLessThan(events.length);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("coalesces concurrent writes for the same transcript key to the latest pending record", async () => {
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    stringifyCalls += 1;
    return originalStringify(value, ...(args as []));
  }) as typeof JSON.stringify;
  try {
    await Promise.all([
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 1,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t1",
              item: { type: "agentMessage", id: "a1", text: "first" },
            },
          } as any,
        ],
      }),
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 2,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t2",
              item: { type: "agentMessage", id: "a2", text: "middle" },
            },
          } as any,
        ],
      }),
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 3,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t3",
              item: { type: "agentMessage", id: "a3", text: "latest" },
            },
          } as any,
        ],
      }),
    ]);
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(stringifyCalls).toBeLessThanOrEqual(2);
  const cached = await readTranscriptCache("codex:coalesced-cache");
  expect(cached?.savedAt).toBe(3);
  expect((cached?.events?.[0].params as any).item.text).toBe("latest");
});

it("queues only bounded cache records for repeated oversized sources", async () => {
  const originalStringify = JSON.stringify;
  const serializedLengths: number[] = [];
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    const serialized = originalStringify(value, ...(args as []));
    serializedLengths.push(serialized.length);
    return serialized;
  }) as typeof JSON.stringify;
  try {
    const hugeEvents = (label: string) =>
      Array.from({ length: 100 }, (_, i) => ({
        method: "item/completed",
        params: {
          threadId: "blocked-cache",
          turnId: `turn-${label}-${i}`,
          item: {
            type: "commandExecution",
            id: `cmd-${label}-${i}`,
            status: "completed",
            aggregatedOutput: `${label}:`.repeat(100_000),
          },
        },
      })) as ServerNotification[];
    const first = writeTranscriptCache({
      key: "codex:blocked-cache",
      savedAt: 20,
      events: hugeEvents("first"),
    });
    const pending = writeTranscriptCache({
      key: "codex:blocked-cache",
      savedAt: 21,
      events: hugeEvents("latest"),
    });
    await Promise.all([first, pending]);
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(serializedLengths).toHaveLength(2);
  expect(Math.max(...serializedLengths)).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:blocked-cache");
  expect(cached?.savedAt).toBe(21);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("resolves superseded writes and rechecks cache invalidation before queued writes persist", async () => {
  const key = "codex:queued-invalidated-cache";
  const first = writeTranscriptCache({
    key,
    savedAt: 10,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t1",
          item: { type: "agentMessage", id: "a1", text: "first" },
        },
      } as any,
    ],
  });
  const superseded = writeTranscriptCache({
    key,
    savedAt: 11,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t2",
          item: { type: "agentMessage", id: "a2", text: "superseded" },
        },
      } as any,
    ],
  });
  const latest = writeTranscriptCache({
    key,
    savedAt: 12,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t3",
          item: { type: "agentMessage", id: "a3", text: "invalidated" },
        },
      } as any,
    ],
  });
  invalidateTranscriptCache(key);
  await expect(Promise.all([first, superseded, latest])).resolves.toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(await readTranscriptCache(key)).toBeUndefined();
});
