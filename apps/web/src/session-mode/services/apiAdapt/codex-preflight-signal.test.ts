import { afterEach, expect, it, vi } from "vitest";

vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => path,
  authHeaders: () => ({}),
  isDesktopTauri: () => false,
  isTauri: () => false,
}));

import { threadGoalSet, threadStart } from "./codex";
import { gitCreateWorktree } from "./git";

afterEach(() => vi.unstubAllGlobals());

const creation = { cwd: "/project" } as Parameters<typeof threadStart>[0];
const goal = { threadId: "selected", objective: "next" };

it.each([
  {
    path: "/api/codex/thread/start",
    body: creation,
    run: (signal?: AbortSignal) => threadStart(creation, { signal }),
  },
  {
    path: "/api/codex/thread/goal/set",
    body: goal,
    run: (signal?: AbortSignal) => threadGoalSet(goal, { signal }),
  },
  {
    path: "/api/git/create-worktree",
    body: { cwd: "/project", worktreeKey: "thread-fixture" },
    run: (signal?: AbortSignal) =>
      gitCreateWorktree("/project", "thread-fixture", { signal }),
  },
])(
  "forwards the deadline signal to $path without changing its request body",
  async ({ path, body, run }) => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await run(controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      path,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
    );
    await run();
    expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
  },
);
