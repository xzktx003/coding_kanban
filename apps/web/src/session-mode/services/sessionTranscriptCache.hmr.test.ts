import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";

const generation = vi.hoisted(() => ({ disposed: false }));
vi.mock("./sessionCacheState", async (original) => ({
  ...(await original<typeof import("./sessionCacheState")>()),
  isTranscriptCacheDisposed: () => generation.disposed,
}));

import {
  cachedTranscriptBaselines,
  cachedTranscriptTimings,
} from "./sessionCacheState";
import {
  readTranscriptCache,
  writeTranscriptCache,
  startSessionTranscriptCache,
} from "./sessionTranscriptCache";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import type { ServerNotification } from "../bindings";

it("rejects an old generation's delayed device restore before effect cleanup, then lets the new generation restore", async () => {
  const id = "hmr-delayed-restore";
  const record = {
    key: `codex:${id}`,
    savedAt: Date.now(),
    events: [
      {
        method: "turn/started",
        params: {
          threadId: id,
          turn: {
            id: "turn",
            status: "inProgress",
            startedAt: 123,
            items: [],
            itemsView: "full",
            error: null,
            completedAt: null,
            durationMs: null,
          },
        },
      },
    ] as ServerNotification[],
  };
  await writeTranscriptCache(record);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id },
      { kind: "codex", id: "later-card" },
    ],
    detachedCard: null,
  });
  useCodexStore.setState({ events: {}, historyLoadedMap: {} });
  cachedTranscriptBaselines.clear();
  cachedTranscriptTimings.clear();
  let releaseRead: (() => void) | undefined;
  const originalGet = IDBObjectStore.prototype.get;
  const get = vi
    .spyOn(IDBObjectStore.prototype, "get")
    .mockImplementation(function (this: IDBObjectStore, key) {
      if (key !== record.key) return originalGet.call(this, key);
      const request = {
        result: record,
        onsuccess: null as (() => void) | null,
        onerror: null,
      };
      releaseRead = () => request.onsuccess?.();
      return request as unknown as IDBRequest;
    });
  let stop = startSessionTranscriptCache();
  try {
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
    // The cache owner's HMR dispose precedes the consuming React effect cleanup.
    // The separate real-Vite test proves this owner signal follows actual disposal.
    generation.disposed = true;
    cachedTranscriptBaselines.clear();
    cachedTranscriptTimings.clear();
    releaseRead!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cachedTranscriptBaselines.has(id)).toBe(false);
    expect(cachedTranscriptTimings.has(id)).toBe(false);
    expect(useCodexStore.getState().events[id]).toBeUndefined();
    expect(get.mock.calls.map(([key]) => key)).toEqual([record.key]);

    stop();
    get.mockRestore();
    expect((await readTranscriptCache(record.key))?.events).toEqual(
      record.events,
    );
    generation.disposed = false;
    stop = startSessionTranscriptCache();
    await vi.waitFor(() =>
      expect(useCodexStore.getState().events[id]).toEqual(record.events),
    );
    expect(cachedTranscriptBaselines.get(id)).toEqual(record.events);
    expect(cachedTranscriptTimings.get(id)?.turnId).toBe("turn");
  } finally {
    stop();
    get.mockRestore();
    generation.disposed = false;
    useAgentCenterStore.setState({ cards: [] });
    cachedTranscriptBaselines.clear();
    cachedTranscriptTimings.clear();
  }
});
