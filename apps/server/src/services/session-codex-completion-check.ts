import type { FollowupThread } from "@agent-orchestrator/shared";

interface Target {
  threadId: string;
  turnId: string;
}
type Decision = "ready" | "wait" | "superseded";

function queueBusy(queue: FollowupThread) {
  return Boolean(
    queue.awaitingTurnId ||
    queue.stopTurnId ||
    queue.replacementId ||
    queue.review?.status === "inProgress" ||
    queue.items.some(
      (item) => item.status !== "sent" && item.status !== "cancelled",
    ),
  );
}
function status(value: any) {
  return typeof value === "string" ? value : value?.type;
}

/** Read-only eligibility, not an atomic fence against another native client. */
export function createSessionCodexCompletionCheck(options: {
  origin: () => string | null;
  fetch: typeof fetch;
  queue: (threadId: string) => Promise<FollowupThread>;
}) {
  const read = async (path: string, threadId: string, extra = {}) => {
    const origin = options.origin();
    if (!origin) throw new Error("会话服务尚未连接");
    const response = await options.fetch(`${origin}/api/codex/thread/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("无法核对完成通知的当前会话状态");
    return response.json();
  };
  return async ({ threadId, turnId }: Target): Promise<Decision> => {
    const initialQueue = await options.queue(threadId);
    const metadata = await read("metadata", threadId);
    const thread = metadata?.thread;
    if (!thread || thread.id !== threadId) return "wait";
    if (
      thread.parentThreadId ||
      thread.source?.subAgent ||
      thread.source?.sub_agent
    )
      return "superseded";
    // Never scan old full history to decide whether an old retry is obsolete.
    const latest = await read("turns/list", threadId, {
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    if (
      !Array.isArray(latest?.data) ||
      latest.data.length !== 1 ||
      typeof latest.data[0]?.id !== "string" ||
      !latest.data[0].id.trim()
    )
      return "wait";
    if (latest.data[0].id !== turnId) return "superseded";
    if (
      status(thread.status) !== "idle" ||
      status(latest.data[0].status) !== "completed" ||
      queueBusy(initialQueue)
    )
      return "wait";
    const goal = await read("goal/get", threadId);
    if (
      !goal ||
      !Object.hasOwn(goal, "goal") ||
      (goal.goal !== null &&
        (goal.goal?.threadId !== threadId || goal.goal?.status !== "complete"))
    )
      return "wait";
    // A new task/approval or queued message can arrive during the native reads.
    const fresh = await read("metadata", threadId);
    const currentQueue = await options.queue(threadId);
    if (
      fresh?.thread?.id !== threadId ||
      status(fresh.thread.status) !== "idle" ||
      currentQueue.revision !== initialQueue.revision ||
      queueBusy(currentQueue)
    )
      return "wait";
    return "ready";
  };
}

/** Only threads actually loaded in this runtime belong to its notification path. */
export function createSessionThreadLookup(options: {
  origin: () => string | null | undefined;
  fetch: typeof fetch;
}) {
  return async (threadId: string): Promise<boolean> => {
    const origin = options.origin();
    if (!origin) return false;
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 32; page++) {
      const response: Response = await options.fetch(
        `${origin}/api/codex/thread/loaded/list`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 100, cursor }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw new Error("无法核对会话通知归属");
      const result: { data?: unknown[]; nextCursor?: unknown } =
        await response.json();
      if (
        !Array.isArray(result?.data) ||
        result.data.some((id: unknown) => typeof id !== "string")
      )
        throw new Error("会话通知归属响应无效");
      if (result.data.includes(threadId)) return true;
      const next = result.nextCursor ?? null;
      if (next === null) return false;
      if (typeof next !== "string" || seen.has(next)) break;
      cursor = next;
      seen.add(next);
    }
    throw new Error("会话通知归属分页未完成");
  };
}
