import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  readTranscriptCache,
  writeTranscriptCache,
  saveReadingPosition,
  getReadingPosition,
} from "./sessionTranscriptCache";
import { invalidateTranscriptCache } from "./sessionCacheState";
import { startSessionTranscriptCache } from "./sessionTranscriptCache";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCodexStore } from "../components/codex/stores";
import {
  trackCodexTranscript,
  markCodexTranscriptDormant,
  forgetCodexTranscript,
} from "./codexTranscriptActivity";
import type { ServerNotification } from "../bindings";
const visibleReply = {
  method: "item/completed",
  params: {
    threadId: "cache",
    turnId: "t",
    item: { type: "agentMessage", id: "final", text: "Final reply" },
  },
} as ServerNotification;

it("does not resurrect dormant bodies from the device cache after a runtime reset", async () => {
  const id = "dormant-device-cache";
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events: [visibleReply],
  });
  trackCodexTranscript(id);
  markCodexTranscriptDormant(id);
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id, cwd: "/repo" }],
    detachedCard: null,
  });
  useCodexStore.setState({ events: {}, historyLoadedMap: {} });
  const stop = startSessionTranscriptCache();
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useCodexStore.getState().events[id]).toBeUndefined();
  } finally {
    stop();
    forgetCodexTranscript(id);
    useAgentCenterStore.setState({ cards: [] });
  }
});
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
            status: "completed",
            command: "pnpm test",
            aggregatedOutput: "complete output",
          },
        },
      } as any,
      visibleReply,
    ],
  });
  const cached = await readTranscriptCache("codex:hidden-output");
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item).toMatchObject({
    type: "commandExecution",
    id: "cmd",
    status: "completed",
    command: "pnpm test",
    aggregatedOutput: null,
    transcriptMetadataOnly: true,
  });
  expect((cached?.events?.[1].params as any).item.text).toBe("Final reply");
  expect(JSON.stringify(cached?.events)).not.toContain("old hidden output");
  expect(JSON.stringify(cached?.events)).not.toContain("complete output");
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
          type: "commandExecution",
          id: "legacy-tool",
          status: "completed",
          command: "legacy command",
          aggregatedOutput: "old tool output",
        },
      },
    },
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
        thread: {
          id: "legacy-output",
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
          turns: [
            {
              id: "old",
              items: [
                {
                  type: "commandExecution",
                  id: "old-tool",
                  aggregatedOutput: "legacy nested output",
                },
              ],
            },
          ],
        },
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
  expect(cached?.thread?.status.type).toBe("notLoaded");
  expect(cached?.thread?.turns).toEqual([]);
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item).toMatchObject({
    id: "legacy-tool",
    type: "commandExecution",
    status: "completed",
    aggregatedOutput: null,
    transcriptMetadataOnly: true,
  });
  expect((cached?.events?.[1].params as any).item.text).toBe(
    "complete visible reply",
  );
  expect(JSON.stringify(cached)).not.toContain("legacy hidden output");
  expect(JSON.stringify(cached)).not.toContain("old tool output");
  expect(JSON.stringify(cached)).not.toContain("legacy nested output");
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

it("drops oversized codex tool payloads before serializing cache records", async () => {
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
      events: [...events, visibleReply],
    });
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(stringifyCalls).toBeLessThanOrEqual(1);
  expect(largestSerialized).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:oversized-tool-cache");
  expect(cached?.events).toHaveLength(121);
  expect(cached?.events).toContainEqual(visibleReply);
  const tools = cached!.events!.filter(
    (event) =>
      event.method === "item/completed" &&
      event.params.item.type === "commandExecution",
  );
  expect(tools).toHaveLength(120);
  for (const event of tools)
    expect((event.params as any).item).toMatchObject({
      status: "completed",
      aggregatedOutput: null,
      transcriptMetadataOnly: true,
    });
  expect(JSON.stringify(cached?.events)).not.toContain("0:".repeat(1024));
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
      events: [...hugeEvents("first"), visibleReply],
    });
    const pending = writeTranscriptCache({
      key: "codex:blocked-cache",
      savedAt: 21,
      events: [...hugeEvents("latest"), visibleReply],
    });
    await Promise.all([first, pending]);
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(serializedLengths).toHaveLength(2);
  expect(Math.max(...serializedLengths)).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:blocked-cache");
  expect(cached?.savedAt).toBe(21);
  expect(cached?.events).toHaveLength(101);
  expect(cached?.events).toContainEqual(visibleReply);
  const tools = cached!.events!.filter(
    (event) =>
      event.method === "item/completed" &&
      event.params.item.type === "commandExecution",
  );
  expect(tools).toHaveLength(100);
  for (const event of tools)
    expect((event.params as any).item).toMatchObject({
      status: "completed",
      aggregatedOutput: null,
      transcriptMetadataOnly: true,
    });
  expect((tools.at(-1)!.params as any).item.id).toBe("cmd-latest-99");
  expect(JSON.stringify(cached?.events)).not.toContain("latest:".repeat(1024));
  expect(JSON.stringify(cached?.events)).not.toContain("first:".repeat(1024));
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

it("persists native hook bigint counters without losing the final reply or precision", async () => {
  const events = [
    {
      method: "hook/completed",
      params: {
        threadId: "hook-cache",
        turnId: "t",
        run: {
          id: "hook",
          eventName: "postToolUse",
          handlerType: "command",
          executionMode: "sync",
          scope: "turn",
          source: "project",
          sourcePath: "/repo/hooks.json",
          displayOrder: 9007199254740994n,
          status: "completed",
          statusMessage: null,
          startedAt: 9007199254740995n,
          completedAt: 9007199254740996n,
          durationMs: 1n,
          entries: [{ kind: "feedback", text: "Public hook result" }],
        },
      },
    },
    visibleReply,
  ] as ServerNotification[];
  await writeTranscriptCache({
    key: "codex:hook-cache",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:hook-cache");
  expect(cached?.events).toHaveLength(2);
  const hook = cached?.events?.find(
    (event) => event.method === "hook/completed",
  );
  expect((hook?.params as any).run.displayOrder).toBe(9007199254740994n);
  expect((hook?.params as any).run.startedAt).toBe(9007199254740995n);
  expect(cached?.events).toContainEqual(visibleReply);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("bounds legacy device records before first restore publishes a baseline or store", async () => {
  const id = "legacy-over-budget";
  const savedAt = Date.now();
  const events = Array.from({ length: 80 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: `turn-${index}`,
      item: {
        type: "agentMessage",
        id: `reply-${index}`,
        text: "visible text ".repeat(6000),
      },
    },
  }));
  events.push({
    method: "turn/completed",
    params: {
      threadId: id,
      turn: {
        id: "turn-79",
        status: "completed",
        startedAt: 123,
        durationMs: 456,
        items: [],
      },
    },
  } as any);
  const record = {
    key: `codex:${id}`,
    savedAt,
    cursor: "older-native-page",
    events,
    bytes: 1,
    thread: { id, turns: [], status: { type: "idle" } },
  };
  expect(
    new TextEncoder().encode(JSON.stringify(record)).byteLength,
  ).toBeGreaterThan(2 * 1024 * 1024);
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
      tx.objectStore("transcripts").put(record);
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
  const cached = await readTranscriptCache(record.key);
  expect(cached).toMatchObject({
    key: record.key,
    savedAt,
  });
  expect(cached?.cursor).toMatch(/^kanban-memory-(?:reload|items):/);
  expect(cached?.cursor).not.toBe(record.cursor);
  expect(
    new TextEncoder().encode(JSON.stringify(cached)).byteLength,
  ).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(cached?.events?.at(-1)).toEqual(events.at(-1));
  const { cachedTranscriptBaselines, cachedTranscriptTimings } =
    await import("./sessionCacheState");
  const { useSessionSyncStore } = await import("../stores/useSessionSyncStore");
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id, cwd: "/repo" }],
    detachedCard: null,
  });
  useCodexStore.setState({ events: {}, historyLoadedMap: {} });
  const published: number[] = [];
  const unsubscribe = useCodexStore.subscribe((state) => {
    if (state.events[id])
      published.push(
        new TextEncoder().encode(JSON.stringify(state.events[id])).byteLength,
      );
  });
  const stop = startSessionTranscriptCache();
  try {
    await vi.waitFor(() =>
      expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true),
    );
    expect(published.length).toBeGreaterThan(0);
    expect(Math.max(...published)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(cachedTranscriptBaselines.get(id)).toBe(
      useCodexStore.getState().events[id],
    );
    expect(cachedTranscriptTimings.get(id)).toMatchObject({
      turnId: "turn-79",
      status: "completed",
      startedAtMs: 123000,
      durationMs: 456,
    });
    expect(useSessionSyncStore.getState().cursors[id]).toBe(cached?.cursor);
  } finally {
    unsubscribe();
    stop();
    cachedTranscriptBaselines.delete(id);
    cachedTranscriptTimings.delete(id);
    useAgentCenterStore.setState({ cards: [] });
  }
});

it("replaces a stale native cursor when writing a shorter cached history window", async () => {
  const id = "write-trim-cursor";
  const events = Array.from({ length: 80 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: `trim-turn-${index}`,
      item: {
        type: "agentMessage",
        id: `trim-reply-${index}`,
        text: "visible text ".repeat(6000),
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events,
    cursor: "before-original-turn-0",
  });
  const cached = await readTranscriptCache(`codex:${id}`);
  expect(cached?.events?.length).toBeGreaterThan(0);
  expect(cached!.events!.length).toBeLessThan(events.length);
  expect(cached?.cursor).toMatch(/^kanban-memory-(?:reload|items):/);
  const first = cached!.events![0] as any;
  const cursor = cached!.cursor!;
  if (cursor.startsWith("kanban-memory-reload:"))
    expect(
      decodeURIComponent(cursor.slice("kanban-memory-reload:".length)),
    ).toBe(first.params.turnId);
  else
    expect(
      JSON.parse(
        decodeURIComponent(cursor.slice("kanban-memory-items:".length)),
      ),
    ).toMatchObject({
      turnId: first.params.turnId,
      beforeItemId: first.params.item.id,
    });
});

it("retains a same-turn item recovery anchor when the cache event window drops a prefix", async () => {
  const id = "same-turn-cache-window";
  const events = Array.from({ length: 900 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: "one-turn",
      item: {
        type: "agentMessage",
        id: `one-item-${index}`,
        text: `reply ${index}`,
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events,
    cursor: "before-original-turn",
  });
  const cached = await readTranscriptCache(`codex:${id}`);
  expect(cached?.events).toHaveLength(600);
  expect(cached?.cursor).toMatch(/^kanban-memory-items:/);
  expect(
    JSON.parse(
      decodeURIComponent(cached!.cursor!.slice("kanban-memory-items:".length)),
    ),
  ).toEqual({ turnId: "one-turn", beforeItemId: "one-item-300" });
});
