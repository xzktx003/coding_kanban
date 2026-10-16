import { afterEach, expect, it, vi } from "vitest";
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => path,
  authHeaders: () => ({}),
  isDesktopTauri: () => false,
  isTauri: () => false,
}));
import { threadGoalClearCompleted } from "./goalCompletion";
afterEach(() => vi.unstubAllGlobals());

it("posts the full expected goal and owner generation once, preserves false, and forwards cancellation", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ cleared: false, reason: "goalChanged" }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const params = {
    threadId: "t",
    expectedAccessGeneration: 4,
    expectedGoal: {
      threadId: "t",
      objective: "done",
      status: "complete" as const,
      tokenBudget: null,
      tokensUsed: 2,
      timeUsedSeconds: 1,
      createdAt: 100,
      updatedAt: 101,
    },
  };
  const controller = new AbortController();
  await expect(
    threadGoalClearCompleted(params, { signal: controller.signal }),
  ).resolves.toEqual({ cleared: false, reason: "goalChanged" });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/codex/thread/goal/clear-completed",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify(params),
      signal: controller.signal,
    }),
  );
});
