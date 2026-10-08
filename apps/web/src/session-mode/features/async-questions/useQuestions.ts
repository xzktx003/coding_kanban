import { useEffect, useMemo } from "react";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { collectQuestions, hasReplyReceipt, latestQuestionTurn } from "./model";
import {
  EMPTY_SESSION,
  pendingQuestions,
  useAsyncQuestionStore,
  withConfirmed,
} from "./store";
const EMPTY_EVENTS: [] = [];
export function useQuestions(threadId: string) {
  const events = useCodexStore((s) => s.events[threadId] ?? EMPTY_EVENTS);
  const knownTurnId = useCodexStore(
    (s) =>
      s.turnTimingMap[threadId]?.turnId ??
      (s.currentThreadId === threadId ? s.currentTurnId : null) ??
      s.threads.find((t) => t.id === threadId)?.turns?.at(-1)?.id,
  );
  const latestTurnId = latestQuestionTurn(events, threadId, knownTurnId);
  const session = useAsyncQuestionStore(
    (s) => s.sessions[threadId] ?? EMPTY_SESSION,
  );
  const native = collectQuestions(events, threadId);
  const questions = useMemo(
    () => withConfirmed(native, session),
    [native, session.confirmed],
  );
  useEffect(() => {
    const drafts = { ...session.drafts };
    let changed = false;
    for (const q of questions) {
      const d = drafts[q.id];
      if (
        d &&
        !d.skipped &&
        d.baseline !== q.answer &&
        d.text === (d.baseline ?? "")
      ) {
        drafts[q.id] = {
          text: q.answer ?? "",
          baseline: q.answer,
          skipped: false,
        };
        changed = true;
      }
    }
    if (changed) useAsyncQuestionStore.getState().patch(threadId, { drafts });
  }, [questions, session.drafts, threadId]);
  useEffect(() => {
    if (
      session.uncertain &&
      session.uncertainClientId &&
      hasReplyReceipt(
        events,
        threadId,
        session.uncertainClientId,
        session.uncertain,
      )
    )
      useAsyncQuestionStore.getState().patch(threadId, {
        uncertain: undefined,
        uncertainClientId: undefined,
        error: undefined,
        openId: undefined,
      });
  }, [events, session.uncertain, session.uncertainClientId, threadId]);
  useEffect(() => {
    if (!session.confirmed) return;
    const confirmed = { ...session.confirmed };
    let changed = false;
    for (const q of native) {
      const receipt = confirmed[q.id];
      if (
        receipt &&
        (q.answer === receipt.answer || q.answer !== receipt.baseline)
      ) {
        delete confirmed[q.id];
        changed = true;
      }
    }
    if (changed)
      useAsyncQuestionStore.getState().patch(threadId, { confirmed });
  }, [native, session.confirmed, threadId]);
  return {
    questions,
    session,
    pending: pendingQuestions(questions, session, latestTurnId),
  };
}
