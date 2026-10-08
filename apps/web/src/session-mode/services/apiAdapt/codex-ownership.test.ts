import { afterEach, expect, it, vi } from "vitest";
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (p: string) => p,
  authHeaders: () => ({}),
  isDesktopTauri: () => false,
  isTauri: () => false,
}));
import { threadRead } from "./codex";
afterEach(() => vi.unstubAllGlobals());
it("history reads never resume, including when an older runtime cannot serve reads", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ thread: { id: "same", turns: [] } }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await threadRead({ threadId: "same" });
  expect(fetcher.mock.calls[0][0]).toBe("/api/codex/thread/read");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    threadId: "same",
  });
  fetcher.mockResolvedValue(new Response("{}", { status: 404 }));
  await expect(threadRead({ threadId: "same" })).rejects.toThrow(/只读历史/);
  expect(
    fetcher.mock.calls.every(([url]) => url === "/api/codex/thread/read"),
  ).toBe(true);
});
