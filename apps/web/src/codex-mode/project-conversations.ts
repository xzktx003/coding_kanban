import { postJsonWithOptions } from "@session/services/apiAdapt/shared";

export type CodexProjectConversation = {
  id: string;
  cwd: string;
  name: string | null;
  preview: string;
  updatedAt: number;
};

type ThreadPage = {
  data: unknown[];
  nextCursor: string | null;
};

export type ThreadListQuery = (
  params: {
    cwd: string;
    limit: number;
    sortKey: "updated_at";
    sortDirection: "desc";
    modelProviders: string[];
    archived: false;
    useStateDbOnly: true;
    cursor?: string;
  },
  signal?: AbortSignal,
) => Promise<unknown>;

const PAGE_SIZE = 100;
const MAX_PAGES = 1_000;
const PAGE_LIMIT_ERROR = "Codex 会话列表分页过多，无法确认项目会话总数";
const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const queryThreadList: ThreadListQuery = (params, signal) =>
  postJsonWithOptions<unknown>("/api/codex/thread/list", params, {
    signal,
    suppressToast: true,
  });

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePage(value: unknown): ThreadPage {
  const result = record(value);
  if (
    !result ||
    !Array.isArray(result.data) ||
    result.data.length > PAGE_SIZE ||
    (result.nextCursor !== null && typeof result.nextCursor !== "string")
  )
    throw new Error("Codex 会话列表返回了无效分页数据");
  return {
    data: result.data,
    nextCursor: result.nextCursor as string | null,
  };
}

function resumableConversation(
  value: unknown,
  project: string,
): CodexProjectConversation | null {
  const row = record(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    !THREAD_ID.test(row.id) ||
    typeof row.cwd !== "string" ||
    (row.name !== null && typeof row.name !== "string") ||
    typeof row.preview !== "string" ||
    !Number.isFinite(row.updatedAt) ||
    typeof row.ephemeral !== "boolean" ||
    (row.parentThreadId !== null && typeof row.parentThreadId !== "string")
  )
    throw new Error("Codex 会话列表包含无效会话");
  if (row.cwd !== project || row.ephemeral || row.parentThreadId !== null)
    return null;
  return {
    id: row.id,
    cwd: row.cwd,
    name: row.name as string | null,
    preview: row.preview,
    updatedAt: row.updatedAt as number,
  };
}

export async function loadProjectList(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetcher("/api/session/projects", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(`项目列表暂不可用（HTTP ${response.status}）`);
  const value = record(await response.json());
  if (!value || !Array.isArray(value.projects))
    throw new Error("项目列表返回了无效数据");
  const unique = new Set<string>();
  for (const project of value.projects) {
    if (
      typeof project === "string" &&
      project.startsWith("/") &&
      project.length <= 4096 &&
      project.trim() === project &&
      !/[\\\u0000-\u001f\u007f]/.test(project)
    )
      unique.add(project);
  }
  return [...unique];
}

export async function loadProjectConversations(
  project: string,
  query: ThreadListQuery = queryThreadList,
  signal?: AbortSignal,
): Promise<CodexProjectConversation[]> {
  if (
    !project.startsWith("/") ||
    project.length > 4096 ||
    project.trim() !== project ||
    /[\\\u0000-\u001f\u007f]/.test(project)
  )
    throw new Error("项目路径无效");

  const cursorHistory = new Set<string>();
  const conversations = new Map<string, CodexProjectConversation>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    if (++pages > MAX_PAGES) throw new Error(PAGE_LIMIT_ERROR);
    if (signal?.aborted)
      throw new DOMException("项目会话读取已取消", "AbortError");
    const params = {
      cwd: project,
      limit: PAGE_SIZE,
      sortKey: "updated_at" as const,
      sortDirection: "desc" as const,
      modelProviders: [],
      archived: false as const,
      useStateDbOnly: true as const,
      ...(cursor === null ? {} : { cursor }),
    };
    const page = parsePage(await query(params, signal));
    if (signal?.aborted)
      throw new DOMException("项目会话读取已取消", "AbortError");
    for (const raw of page.data) {
      const item = resumableConversation(raw, project);
      if (item && !conversations.has(item.id)) conversations.set(item.id, item);
    }
    if (page.nextCursor === null) break;
    if (!page.nextCursor || cursorHistory.has(page.nextCursor))
      throw new Error("Codex 会话列表分页游标重复，无法确认项目会话总数");
    cursorHistory.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);

  return [...conversations.values()];
}
