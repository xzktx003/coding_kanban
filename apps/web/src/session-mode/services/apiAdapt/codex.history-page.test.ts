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
