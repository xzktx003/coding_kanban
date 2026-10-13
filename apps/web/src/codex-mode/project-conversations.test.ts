import { expect, it, vi } from "vitest";
import {
  loadProjectConversations,
  loadProjectList,
  type ThreadListQuery,
} from "./project-conversations";

const cwd = "/tmp/project-a";
const threadA = "00000000-0000-4000-8000-000000000001";
const threadB = "00000000-0000-4000-8000-000000000002";

it("loads every resumable conversation for one project across cursor pages", async () => {
  const requests: Array<{
    params: Parameters<ThreadListQuery>[0];
    signal?: AbortSignal;
  }> = [];
  const pages: unknown[] = [
    {
      data: [
        {
          id: threadA,
          cwd,
          name: "First",
          preview: "first prompt",
          updatedAt: 20,
          parentThreadId: null,
          ephemeral: false,
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          cwd,
          name: "Subagent",
          preview: "child prompt",
          updatedAt: 19,
          parentThreadId: threadA,
          ephemeral: false,
        },
      ],
      nextCursor: "cursor-1",
    },
    {
      data: [
        {
          id: threadB,
          cwd,
          name: null,
          preview: "second prompt",
          updatedAt: 10,
          parentThreadId: null,
          ephemeral: false,
        },
        {
          id: "00000000-0000-4000-8000-000000000004",
          cwd,
          name: null,
          preview: "ephemeral",
          updatedAt: 9,
          parentThreadId: null,
          ephemeral: true,
        },
      ],
      nextCursor: null,
    },
  ];
  const query: ThreadListQuery = async (params, signal) => {
    requests.push({ params, signal });
    return pages.shift();
  };

  const result = await loadProjectConversations(cwd, query);

  expect(result.map(({ id }) => id)).toEqual([threadA, threadB]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.params).toMatchObject({
    cwd,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    modelProviders: [],
    useStateDbOnly: true,
  });
  expect(requests[1]?.params).toMatchObject({ cwd, cursor: "cursor-1" });
});

it("rejects a repeated pagination cursor instead of reporting a false total", async () => {
  let calls = 0;
  const query: ThreadListQuery = async () => {
    calls += 1;
    return { data: [], nextCursor: "same-cursor" };
  };

  await expect(loadProjectConversations(cwd, query)).rejects.toThrow(
    /游标重复/,
  );
  expect(calls).toBe(2);
});

it("loads the shared project registry once and keeps only unique absolute paths", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      ({
        ok: true,
        json: async () => ({
          projects: [
            cwd,
            cwd,
            "/tmp/project-b",
            "relative/project",
            "/tmp/bad\npath",
          ],
        }),
      }) as Response,
  );

  await expect(loadProjectList(fetcher)).resolves.toEqual([
    cwd,
    "/tmp/project-b",
  ]);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/session/projects", {
    method: "GET",
    cache: "no-store",
    signal: undefined,
  });
});

it("does not return conversations from a different working directory", async () => {
  const query: ThreadListQuery = async () => ({
    data: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        cwd: "/tmp/other-project",
        name: "Other project",
        preview: "other",
        updatedAt: 2,
        parentThreadId: null,
        ephemeral: false,
      },
    ],
    nextCursor: null,
  });

  await expect(loadProjectConversations(cwd, query)).resolves.toEqual([]);
});

it("rejects thread IDs that the native Resume route cannot address", async () => {
  const query: ThreadListQuery = async () => ({
    data: [
      {
        id: "thread-without-a-uuid",
        cwd,
        name: null,
        preview: "not resumable",
        updatedAt: 1,
        parentThreadId: null,
        ephemeral: false,
      },
    ],
    nextCursor: null,
  });

  await expect(loadProjectConversations(cwd, query)).rejects.toThrow(
    "Codex 会话列表包含无效会话",
  );
});
