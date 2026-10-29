import { beforeEach, expect, it, vi } from "vitest";
import {
  MEMORY_HISTORY_RESTART_CURSOR,
  MEMORY_ITEM_CURSOR,
  memoryHistoryWindows,
} from "./sessionMemoryHistory";

const postJsonWithOptions = vi.hoisted(() => vi.fn());

vi.mock("./apiAdapt/shared", () => ({
  postJsonWithOptions,
  postJson: vi.fn(),
  postNoContent: vi.fn(),
  getJson: vi.fn(),
  SessionApiError: class extends Error {},
}));

const item = (id: string) => ({ id, type: "agentMessage", text: id });

function itemsPage(ids: string[], nextCursor: string | null) {
  return {
    data: ids.map((id) => ({ turnId: "turn-1", item: item(id) })),
    nextCursor,
  };
}

const itemCursor = (payload: Record<string, unknown>) =>
  MEMORY_ITEM_CURSOR + encodeURIComponent(JSON.stringify(payload));

beforeEach(() => {
  postJsonWithOptions.mockReset();
  memoryHistoryWindows.clear();
});

const parseCursor = (cursor: string) =>
  JSON.parse(decodeURIComponent(cursor.slice(MEMORY_ITEM_CURSOR.length)));

it("advances the cursor instead of repeating a page that yields nothing older", async () => {
  const { threadRead } = await import("./apiAdapt/codex");
  // The browser stall: the anchor was the last entry, so slice(index + 1) was
  // empty, yet the branch still emitted a cursor pointing at the same request.
  // Every click then re-read the same items and the deduplicating merge
  // produced no net change, leaving the reader with no way forward.
  postJsonWithOptions.mockResolvedValueOnce(itemsPage(["anchor"], "native-2"));
  postJsonWithOptions.mockResolvedValueOnce(itemsPage([], null));

  const input = itemCursor({ turnId: "turn-1", beforeItemId: "anchor" });
  const result = await threadRead({
    threadId: "t",
    recent: true,
    cursor: input,
  });

  expect(result.historyPage?.nextCursor).not.toBe(input);
  // An exhausted turn hands off to whole-turn recovery rather than latching.
  expect(result.historyPage?.nextCursor).toBe(
    MEMORY_HISTORY_RESTART_CURSOR + encodeURIComponent("turn-1"),
  );
});

it("forwards only the native cursor, which already excludes paged items", async () => {
  const { threadRead } = await import("./apiAdapt/codex");
  postJsonWithOptions.mockResolvedValueOnce(
    itemsPage(["anchor", "older-1"], "native-2"),
  );

  const result = await threadRead({
    threadId: "t",
    recent: true,
    cursor: itemCursor({ turnId: "turn-1", beforeItemId: "anchor" }),
  });

  const next = parseCursor(result.historyPage!.nextCursor!);
  expect(next.cursor).toBe("native-2");
  // Re-sending the anchor would make the next read search for an item the
  // cursor has already consumed, which threw and aborted the whole read.
  expect(next.beforeItemId).toBeUndefined();
});

it("falls back to whole-turn recovery when the turn's items run out", async () => {
  const { threadRead } = await import("./apiAdapt/codex");
  postJsonWithOptions.mockResolvedValueOnce(itemsPage(["only"], null));

  const result = await threadRead({
    threadId: "t",
    recent: true,
    cursor: itemCursor({ turnId: "turn-1" }),
  });

  expect(result.historyPage?.nextCursor).toBe(
    MEMORY_HISTORY_RESTART_CURSOR + encodeURIComponent("turn-1"),
  );
});

it("hands off to whole-turn recovery when the anchor is no longer locatable", async () => {
  const { threadRead } = await import("./apiAdapt/codex");
  // Observed in the browser as "Released tool history could not be located".
  // A stale anchor latched a hard error banner, which also disables the upward
  // scroll trigger, so the reader could not page at all.
  postJsonWithOptions.mockResolvedValueOnce(itemsPage(["unrelated"], null));

  const result = await threadRead({
    threadId: "t",
    recent: true,
    cursor: itemCursor({ turnId: "turn-1", beforeItemId: "vanished" }),
  });

  expect(result.historyPage?.nextCursor).toBe(
    MEMORY_HISTORY_RESTART_CURSOR + encodeURIComponent("turn-1"),
  );
});

it("pins the turns actually recovered by an item page", async () => {
  const { threadRead } = await import("./apiAdapt/codex");
  postJsonWithOptions.mockResolvedValueOnce(itemsPage(["older-1"], "native-2"));

  await threadRead({
    threadId: "t",
    recent: true,
    cursor: itemCursor({ turnId: "turn-1" }),
  });

  expect(memoryHistoryWindows.get("t")?.has("turn-1")).toBe(true);
});
