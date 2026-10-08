import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { codexService } from "../../services/codexService";
import { SessionApiError } from "../../services/apiAdapt/shared";
import {
  collectQuestions,
  encodeReplies,
  hasReplyReceipt,
  type Reply,
} from "./model";
import { EMPTY_SESSION, useAsyncQuestionStore } from "./store";

/** undefined means the thread is active but its turn identity is not yet known. */
export function answerTarget(threadId: string): string | null | undefined {
  const runtime = codexRuntimeState(useCodexStore.getState(), threadId);
  if (runtime.running) return runtime.turnId ?? undefined;
  return runtime.known ? null : undefined;
}
function questionsNow(id: string) {
  return collectQuestions(useCodexStore.getState().events[id] ?? [], id);
}
function isRejected(error: unknown): boolean {
  if (
    error instanceof SessionApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
  )
    return true;
  // The current Rust gateway wraps explicit JSON-RPC rejections in HTTP 500.
  // Only the structured native error envelope is conclusive, not arbitrary 5xx text.
  if (error instanceof Error && error.message.startsWith("Request failed: {")) {
    try {
      const rpc = JSON.parse(error.message.slice("Request failed: ".length));
      return (
        [-32600, -32601, -32602].includes(rpc.code) &&
        typeof rpc.message === "string"
      );
    } catch {
      /* leave an unknown transport failure locked */
    }
  }
  return false;
}
export async function sendAnswers(
  threadId: string,
  sourceId: string,
  expectedTurnId: string | null,
) {
  const store = useAsyncQuestionStore.getState();
  const session = store.sessions[threadId] ?? EMPTY_SESSION;
  if (session.sending || session.uncertain) return;
  const questions = questionsNow(threadId).filter(
    (q) => q.sourceId === sourceId,
  );
  if (!questions.length) {
    store.patch(threadId, {
      openId: undefined,
      error: "原问题已移除，未发送回答。",
    });
    return;
  }
  if (answerTarget(threadId) !== expectedTurnId) {
    store.patch(threadId, {
      error: "任务状态已变化，草稿已保留。请确认当前按钮后再提交。",
    });
    return;
  }
  const replies: Reply[] = questions.flatMap((q) => {
    const d = session.drafts[q.id];
    return d && !d.skipped && d.text.trim()
      ? [{ questionItemId: q.id, question: q.title, answer: d.text.trim() }]
      : [];
  });
  if (!replies.length) {
    store.patch(threadId, { openId: undefined });
    return;
  }
  store.patch(threadId, { sending: true, error: undefined });
  const clientId = crypto.randomUUID();
  try {
    const input = encodeReplies(replies);
    if (expectedTurnId === null)
      await codexService.turnStart(threadId, input, [], clientId);
    else
      await codexService.turnSteer(
        threadId,
        expectedTurnId,
        input,
        [],
        clientId,
      );
    // Rollback or deletion while an HTTP response was in flight must not
    // resurrect a question or open a panel in another session.
    const alive = new Set(questionsNow(threadId).map((q) => q.id));
    const current =
      useAsyncQuestionStore.getState().sessions[threadId] ?? EMPTY_SESSION;
    const confirmed = { ...current.confirmed },
      drafts = { ...current.drafts };
    for (const reply of replies)
      if (alive.has(reply.questionItemId)) {
        confirmed[reply.questionItemId] = {
          answer: reply.answer,
          baseline: questions.find((q) => q.id === reply.questionItemId)
            ?.answer,
        };
        drafts[reply.questionItemId] = {
          text: reply.answer,
          baseline: reply.answer,
          skipped: false,
        };
      }
    store.patch(threadId, {
      confirmed,
      drafts,
      openId: undefined,
      uncertain: undefined,
      uncertainClientId: undefined,
      error: undefined,
    });
  } catch (error) {
    // 4xx rejection is definite; gateway/timeouts/network errors can occur
    // after delivery and must remain locked until an accepted echo is found.
    const rejected = isRejected(error);
    store.patch(threadId, {
      uncertain: rejected ? undefined : replies,
      uncertainClientId: rejected ? undefined : clientId,
      error: rejected
        ? `回答未发送：${error instanceof Error ? error.message : String(error)}`
        : "发送结果尚未确认，草稿已保留。请核对发送结果，避免重复提交。",
    });
    if (
      rejected &&
      error instanceof Error &&
      error.message.startsWith("Request failed: {")
    ) {
      // A turn may have ended before its stream notification arrived. Refresh
      // its status, but never convert the rejected steer into a new turn.
      try {
        await codexService.threadResume(threadId);
      } catch {
        /* retain the original actionable error */
      }
    }
  } finally {
    store.patch(threadId, { sending: false });
  }
}

export async function reconcileAnswers(threadId: string) {
  const store = useAsyncQuestionStore.getState(),
    session = store.sessions[threadId];
  if (!session?.uncertain || session.sending) return;
  store.patch(threadId, { sending: true });
  try {
    // Existing rejoin reconciles history without creating a turn or interrupting it.
    await codexService.threadResume(threadId);
    const questions = questionsNow(threadId);
    const matched =
      !!session.uncertainClientId &&
      hasReplyReceipt(
        useCodexStore.getState().events[threadId] ?? [],
        threadId,
        session.uncertainClientId,
        session.uncertain,
      );
    const removed = session.uncertain.every(
      (r) => !questions.some((q) => q.id === r.questionItemId),
    );
    store.patch(
      threadId,
      matched || removed
        ? {
            uncertain: undefined,
            uncertainClientId: undefined,
            error: undefined,
            openId: undefined,
          }
        : {
            error: "历史中尚未确认这次回答。请稍后再次核对；本次不会重复发送。",
          },
    );
  } catch {
    store.patch(threadId, {
      error: "暂时无法核对，请恢复连接后重试核对。草稿已保留。",
    });
  } finally {
    store.patch(threadId, { sending: false });
  }
}
