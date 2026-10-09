import { afterEach, expect, it, vi } from "vitest";
import { threadRead } from "./codex";
afterEach(() => vi.unstubAllGlobals());
const turn = (id: string) => ({ id, items: [], status: "completed" });
it("reads recent turns until the last observed turn and never resumes execution", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [turn("new-3"), turn("new-2")],
          nextCursor: "page2",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [turn("known"), turn("older")],
          nextCursor: "page3",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await threadRead({
    threadId: "a",
    recent: true,
    afterTurnId: "known",
  });
  expect(result.thread.turns.map((t) => t.id)).toEqual([
    "older",
    "known",
    "new-2",
    "new-3",
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.every((c) =>
      String(c[0]).endsWith("/thread/turns/list"),
    ),
  ).toBe(true);
});
it("falls back for a missing read capability but never for a business failure", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ thread: { id: "a", turns: [] } })),
    );
  vi.stubGlobal("fetch", fetcher);
  await threadRead({ threadId: "a", recent: true });
  expect(String(fetcher.mock.calls[1][0])).toMatch(/\/thread\/read$/);
  fetcher
    .mockClear()
    .mockResolvedValueOnce(new Response("{}", { status: 500 }));
  await expect(threadRead({ threadId: "a", recent: true })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
it("restores released turns with summary scans and bounded full pages without acquiring execution", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [turn("new"), turn("anchor")],
          nextCursor: "older",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [turn("new"), turn("anchor")],
          nextCursor: "older",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [turn("old-2"), turn("old-1")],
          nextCursor: "oldest",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await threadRead({
    threadId: "a",
    recent: true,
    cursor: "kanban-memory-reload:anchor",
  });
  expect(result.thread.turns.map((t) => t.id)).toEqual(["old-1", "old-2"]);
  expect(result.historyPage).toEqual({ nextCursor: "oldest", earlier: true });
  const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(bodies.map((body) => body.itemsView)).toEqual([
    "summary",
    "full",
    "full",
  ]);
  expect(bodies.map((body) => body.cursor)).toEqual([null, null, "older"]);
  expect(
    fetcher.mock.calls.every((call) =>
      String(call[0]).endsWith("/thread/turns/list"),
    ),
  ).toBe(true);
});
it("does not guess a page when a released anchor disappeared", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: [turn("other")], nextCursor: null })),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    threadRead({
      threadId: "a",
      recent: true,
      cursor: "kanban-memory-reload:missing",
    }),
  ).rejects.toThrow("History changed");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("rejects an anchor that disappears between summary and full reads", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [turn("anchor")], nextCursor: null }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [turn("other")], nextCursor: null })),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    threadRead({
      threadId: "a",
      recent: true,
      cursor: "kanban-memory-reload:anchor",
    }),
  ).rejects.toThrow("History changed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds missed-live-turn recovery instead of accumulating an entire old transcript", async () => {
  let page = 0;
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [turn(`new-${++page}`)],
          nextCursor: `page-${page}`,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await threadRead({
    threadId: "a",
    recent: true,
    afterTurnId: "far-away",
  });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(result.thread.turns).toHaveLength(5);
  expect(result.historyPage).toMatchObject({
    truncated: true,
    nextCursor: "page-1",
  });
});
it("recovers a released item window inside one long-running turn with bounded item pages", async () => {
  const entry = (id: string) => ({
    turnId: "live",
    item: {
      id,
      type: "commandExecution",
      command: id,
      status: "completed",
      aggregatedOutput: "result",
      commandActions: [],
      exitCode: 0,
      durationMs: 1,
    },
  });
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: [entry("new"), entry("anchor"), entry("old")],
        nextCursor: "older-items",
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const cursor =
    "kanban-memory-items:" +
    encodeURIComponent(
      JSON.stringify({ turnId: "live", beforeItemId: "anchor" }),
    );
  const result = await threadRead({ threadId: "a", recent: true, cursor });
  expect(result.thread.turns[0].items.map((item) => item.id)).toEqual(["old"]);
  expect(result.historyPage).toMatchObject({ itemPage: true, earlier: true });
  expect(String(fetcher.mock.calls[0][0])).toMatch(/\/thread\/items\/list$/);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    threadId: "a",
    turnId: "live",
    limit: 20,
    sortDirection: "desc",
    cursor: null,
  });
});
