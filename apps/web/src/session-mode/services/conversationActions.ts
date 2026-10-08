import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { postJsonWithOptions } from "./apiAdapt/shared";
import type { ReviewStartResponse } from "../bindings/v2";
import type { ReviewTarget } from "../bindings/v2";
import { threadFork } from "./apiAdapt/codex";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { appendDraft, sessionDraftKey } from "../stores/useSessionDraftStore";
import { useSideChatStore } from "../stores/useSideChatStore";
import { convertThreadHistoryToEvents } from "../utils/threadHistoryConverter";
import { getThreadModelSettings, hydrateThreadModel } from "../stores/useThreadModelStore";
const pending = new Map<string, Promise<string>>();
export function createSideChat(
  parentId: string,
  text = "",
  images: string[] = [],
): Promise<string> {
  const existing = pending.get(parentId);
  if (existing) return existing;
  const task = (async () => {
    const parentModel = getThreadModelSettings(parentId);
    const response = await threadFork({ threadId: parentId });
    const { thread } = response;
    if (!thread?.id || thread.id === parentId)
      throw new Error("服务未返回独立的侧边会话");
    const events = convertThreadHistoryToEvents(thread);
    hydrateThreadModel(thread.id, {
      model: response.model || parentModel.model,
      modelProvider: response.modelProvider ?? parentModel.modelProvider,
      reasoningEffort: response.reasoningEffort === undefined ? parentModel.reasoningEffort : response.reasoningEffort,
    });
    useCodexStore.setState((s) => ({
      threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
      events: { ...s.events, [thread.id]: events },
      activeThreadIds: [...new Set([...s.activeThreadIds, thread.id])],
      threadStatusMap: { ...s.threadStatusMap, [thread.id]: thread.status },
    }));
    useAgentCenterStore
      .getState()
      .addAgentCard(
        { kind: "codex", id: thread.id, cwd: thread.cwd, preview: "侧边聊天" },
        { activate: false },
      );
    if (text) appendDraft(sessionDraftKey("codex", thread.id), text);
    useSideChatStore
      .getState()
      .open({
        id: thread.id,
        parentId,
        title: "侧边聊天",
        images: [...images],
      });
    return thread.id;
  })();
  pending.set(parentId, task);
  void task.finally(() => pending.delete(parentId)).catch(() => {});
  return task;
}
export async function runConversationReview(
  threadId: string,
  delivery: "inline" | "detached",
  target: ReviewTarget,
): Promise<string> {
  const s = useCodexStore.getState();
  if (
    delivery === "inline" &&
    (codexRuntimeState(s, threadId).running)
  )
    throw new Error("当前任务运行中，请选择独立审查");
  const result = await postJsonWithOptions<ReviewStartResponse>(
    "/followups/review",
    { threadId, delivery, target },
    { suppressToast: true },
  );
  if (!result.reviewThreadId || !result.turn?.id)
    throw new Error("服务未返回审查会话");
  const id = result.reviewThreadId;
  const beforeTiming = s.turnTimingMap[id];
  useCodexStore.setState((s) => {
    if (
      s.turnTimingMap[id] &&
      s.turnTimingMap[id] !== beforeTiming &&
      (s.turnTimingMap[id].turnId !== result.turn.id ||
        s.turnTimingMap[id].status !== "inProgress")
    )
      return s;
    return {
      turnTimingMap: {
        ...s.turnTimingMap,
        [id]: {
          turnId: result.turn.id,
          status: result.turn.status,
          startedAtMs: (result.turn.startedAt ?? Date.now() / 1000) * 1000,
          durationMs: result.turn.durationMs ?? null,
        },
      },
      threadStatusMap: {
        ...s.threadStatusMap,
        [id]:
          result.turn.status === "inProgress"
            ? { type: "active", activeFlags: [] }
            : { type: "idle" },
      },
    };
  });
  if (delivery === "detached") {
    const cwd =
      s.threads.find((t) => t.id === threadId)?.cwd ??
      useAgentCenterStore
        .getState()
        .cards.find((c) => c.id === threadId && c.kind === "codex")?.cwd;
    useAgentCenterStore
      .getState()
      .addAgentCard(
        { kind: "codex", id, cwd, preview: "独立代码审查" },
        { activate: false },
      );
    useSideChatStore
      .getState()
      .open({ id, parentId: threadId, title: "独立代码审查", images: [] });
  }
  return id;
}
