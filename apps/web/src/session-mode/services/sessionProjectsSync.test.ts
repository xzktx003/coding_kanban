import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startSessionProjectsSync } from "./sessionProjectsSync";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
const a = "/a";
const b = "/b";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({
    projects: [a],
    pendingProjectOperations: [],
    nextProjectSequence: 1,
    cwd: "/a",
    projectsInitialized: false,
    projectSyncError: null,
  });
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});
it("polling changes only shared projects while local selection/layout changes cause no writes", async () => {
  const fetcher = vi.fn(
    async (_url: unknown, init: RequestInit | undefined) =>
      new Response(
        JSON.stringify({
          initialized: true,
          revision: 1,
          projects: init?.method === "POST" ? [a] : [b, a],
          sequence: 0,
        }),
      ),
  );
  stop = startSessionProjectsSync(fetcher as typeof fetch, 1000);
  await vi.advanceTimersByTimeAsync(1);
  useWorkspaceStore.getState().setProjectSort("name_desc");
  useWorkspaceStore.getState().setCwd("/a");
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher.mock.calls.map((c) => c[1]?.method)).toEqual(["POST", "GET"]);
  expect(useWorkspaceStore.getState().projects).toEqual([b, a]);
  expect(useWorkspaceStore.getState().cwd).toBe("/a");
  expect(useWorkspaceStore.getState().projectSort).toBe("name_desc");
});
it("failed uploads retain operations and retry the same sequence without erasing changes made in flight", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          initialized: true,
          revision: 2,
          projects: [b],
          sequence: 2,
        }),
      ),
    );
  useWorkspaceStore.getState().addProject(b);
  stop = startSessionProjectsSync(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(1);
  expect(useWorkspaceStore.getState().pendingProjectOperations).toHaveLength(1);
  expect(useWorkspaceStore.getState().projectSyncError).toBeTruthy();
  await vi.advanceTimersByTimeAsync(5000);
  useWorkspaceStore.getState().removeProject(a);
  resolve(
    new Response(
      JSON.stringify({
        initialized: true,
        revision: 1,
        projects: [a, b],
        sequence: 1,
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(useWorkspaceStore.getState().projects).toEqual([b]);
  expect(
    useWorkspaceStore.getState().pendingProjectOperations.map((o) => o.seq),
  ).toEqual([2]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).operations[0].seq).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).operations[0].seq).toBe(1);
  await vi.advanceTimersByTimeAsync(60);
  expect(useWorkspaceStore.getState().pendingProjectOperations).toEqual([]);
});
