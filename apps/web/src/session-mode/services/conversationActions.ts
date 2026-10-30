import { captureCodexOperationScope, isCodexOperationScopeCurrent, type CodexOperationScope } from "./codexOperationScope";
import { lightweightThreadForStore } from "./codexTranscriptVisibility";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { lifecycleMutation } from "./lifecycleMutation";
import type { ReviewTarget } from "../bindings/v2";
import { threadFork } from "./apiAdapt/codex";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { appendDraft, sessionDraftKey } from "../stores/useSessionDraftStore";
import { useSideChatStore } from "../stores/useSideChatStore";
import { useSavedTurnReviewStore } from "../stores/useSavedTurnReviewStore";
import { convertThreadHistoryToEvents } from "../utils/threadHistoryConverter";
import {
  getThreadModelSettings,
  hydrateThreadModel,
} from "../stores/useThreadModelStore";
import { nativeThreadSettings } from "./nativeThreadSettings";
const pending = new Map<string, { scope: CodexOperationScope; task: Promise<string> }>();
export function createSideChat(
  parentId: string,
  text = "",
  images: string[] = [],
): Promise<string> {
  const existing = pending.get(parentId);
  if (existing && isCodexOperationScopeCurrent(existing.scope)) return existing.task;
  const scope = captureCodexOperationScope();
  const task = (async () => {
    const parentModel = structuredClone(getThreadModelSettings(parentId));
    const response = await threadFork({ threadId: parentId });
    if (!isCodexOperationScopeCurrent(scope))
      throw new Error("连接或账号已变化，侧边会话结果未确认，请核对原连接，勿重复创建。");
    const { thread } = response;
    if (!thread?.id || thread.id === parentId)
      throw new Error("服务未返回独立的侧边会话");
    const events = convertThreadHistoryToEvents(thread);
    hydrateThreadModel(
      thread.id,
      {
        ...nativeThreadSettings(response),
        model: response.model || parentModel.model,
        modelProvider: response.modelProvider ?? parentModel.modelProvider,
        reasoningEffort:
          response.reasoningEffort === undefined
            ? parentModel.reasoningEffort
            : response.reasoningEffort,
      },
      { initialOnly: true },
    );
    useCodexStore.setState((s) => ({
      threads: [
        lightweightThreadForStore(thread),
        ...s.threads.filter((t) => t.id !== thread.id),
      ],
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
    useSideChatStore.getState().open({
      id: thread.id,
      parentId,
      title: "侧边聊天",
      images: [...images],
    });
    return thread.id;
  })();
  pending.set(parentId, { scope, task });
  void task.finally(() => {
    if (pending.get(parentId)?.task === task) pending.delete(parentId);
  }).catch(() => {});
  return task;
}
export async function runConversationReview(
  threadId: string,
  delivery: "inline" | "detached",
  target: ReviewTarget,
): Promise<string> {
  const scope = captureCodexOperationScope();
  const timingBefore = useCodexStore.getState().turnTimingMap;
  const capturedTarget = structuredClone(target);
  const capturedCwd =
    useCodexStore.getState().threads.find((t) => t.id === threadId)?.cwd ??
    useAgentCenterStore
      .getState()
      .cards.find((c) => c.id === threadId && c.kind === "codex")?.cwd;
  if (delivery === "inline" && codexRuntimeState(useCodexStore.getState(), threadId).running)
    throw new Error("当前任务运行中，请选择独立审查");
  const result = await lifecycleMutation("review", threadId, { delivery, target: capturedTarget });
  if (!isCodexOperationScopeCurrent(scope)) throw new Error("账号或运行服务已变化，审查回执已保留，请核对原会话。");
  if (!result.reviewThreadId || !result.turn?.id)
    throw new Error("服务未返回审查会话");
  const id = result.reviewThreadId;
  const turn = result.turn;
  if (capturedCwd && !result.reconciled)
    useSavedTurnReviewStore.getState().captureReviewScope({
      requestThreadId: threadId,
      reviewThreadId: id,
      turnId: result.turn.id,
      cwd: capturedCwd,
      target: capturedTarget,
    });
  const beforeTiming = timingBefore[id];
  useCodexStore.setState((s) => {
    if (
      s.turnTimingMap[id] &&
      s.turnTimingMap[id] !== beforeTiming &&
      (s.turnTimingMap[id].turnId !== turn.id ||
        s.turnTimingMap[id].status !== "inProgress")
    )
      return s;
    return {
      turnTimingMap: {
        ...s.turnTimingMap,
        [id]: {
          turnId: turn.id,
          status: turn.status,
          startedAtMs: (turn.startedAt ?? Date.now() / 1000) * 1000,
          durationMs: turn.durationMs ?? null,
        },
      },
      threadStatusMap: {
        ...s.threadStatusMap,
        [id]:
          turn.status === "inProgress"
            ? { type: "active", activeFlags: [] }
            : { type: "idle" },
      },
    };
  });
  if (delivery === "detached") {
    const cwd = capturedCwd;
    useAgentCenterStore
      .getState()
      .addAgentCard(
        { kind: "codex", id, cwd, preview: "独立代码审查" },
        { activate: false },
      );
    if (useCodexStore.getState().currentThreadId === threadId) useSideChatStore
      .getState()
      .open({ id, parentId: threadId, title: "独立代码审查", images: [] });
  }
  return id;
}
