import { afterEach, expect, it, vi } from "vitest";
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (p: string) => p,
  authHeaders: () => ({}),
  isDesktopTauri: () => false,
  isTauri: () => false,
}));
import { threadRead, threadMetadata } from "./codex";
afterEach(() => vi.unstubAllGlobals());
it("history reads never resume, including when an older runtime cannot serve reads", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ thread: { id: "same", turns: [] } }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await threadRead({ threadId: "same" });
  expect(fetcher.mock.calls[0][0]).toBe("/api/codex/thread/read?view=chat");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    threadId: "same",
  });
  fetcher.mockResolvedValue(new Response("{}", { status: 404 }));
  await expect(threadRead({ threadId: "same" })).rejects.toThrow(/只读历史/);
  expect(
    fetcher.mock.calls.every(
      ([url]) => url === "/api/codex/thread/read?view=chat",
    ),
  ).toBe(true);
});
it("checks metadata on its bounded read-only endpoint and propagates cancellation without resume", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ thread: { id: "same", source: "vscode" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  await threadMetadata("same", { signal: controller.signal });
  expect(fetcher.mock.calls[0][0]).toBe("/api/codex/thread/metadata?view=chat");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ threadId: "same" });
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
});
