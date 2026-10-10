import { create } from "zustand";
import type { Question, Reply } from "./model";
export type QuestionDraft = {
  text: string;
  baseline?: string;
  skipped: boolean;
  turnId?: string;
};
export type QuestionSession = {
  openId?: string;
  openTurnId?: string;
  presentedSources?: string[];
  drafts: Record<string, QuestionDraft>;
  sending: boolean;
  error?: string;
  uncertain?: Reply[];
  uncertainClientId?: string;
  confirmed?: Record<
    string,
    { answer: string; baseline?: string; turnId?: string }
  >;
};
export const EMPTY_SESSION: QuestionSession = { drafts: {}, sending: false };
export const useAsyncQuestionStore = create<{
  sessions: Record<string, QuestionSession>;
  patch: (threadId: string, patch: Partial<QuestionSession>) => void;
  open: (threadId: string, questions: Question[], id?: string) => void;
  edit: (
    threadId: string,
    question: Question,
    text: string,
    skipped?: boolean,
  ) => void;
}>((set, get) => ({
  sessions: {},
  patch: (id, patch) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: { ...(s.sessions[id] ?? EMPTY_SESSION), ...patch },
      },
    })),
  open: (id, questions, selected) => {
    const old = get().sessions[id] ?? EMPTY_SESSION;
    const drafts = { ...old.drafts };
    for (const q of questions) {
      const draft = drafts[q.id];
      if (
        !draft ||
        (draft.turnId !== undefined && draft.turnId !== q.turnId) ||
        draft.text === (draft.baseline ?? "")
      )
        drafts[q.id] = {
          text: q.answer ?? "",
          baseline: q.answer,
          skipped: false,
          turnId: q.turnId,
        };
    }
    get().patch(id, {
      openId: selected ?? questions[0]?.id,
      openTurnId: questions[0]?.turnId,
      drafts,
    });
  },
  edit: (id, q, text, skipped = false) => {
    const old = get().sessions[id] ?? EMPTY_SESSION;
    get().patch(id, {
      drafts: {
        ...old.drafts,
        [q.id]: {
          text,
          skipped,
          turnId: q.turnId,
          baseline: old.drafts[q.id]?.baseline ?? q.answer,
        },
      },
    });
  },
}));
export const pendingQuestions = (
  questions: Question[],
  session: QuestionSession,
  latestTurnId: string | null,
) =>
  questions.filter(
    (q) =>
      q.turnId === latestTurnId &&
      q.answer === undefined &&
      !session.drafts[q.id]?.skipped,
  );

/** An HTTP acknowledgement is confirmed delivery; later native answers win. */
export function withConfirmed(questions: Question[], session: QuestionSession) {
  return questions.map((q) => {
    const receipt = session.confirmed?.[q.id];
    return receipt &&
      (receipt.turnId === undefined || receipt.turnId === q.turnId) &&
      q.answer === receipt.baseline
      ? { ...q, answer: receipt.answer }
      : q;
  });
}

export function clearAsyncQuestions(threadId: string) {
  useAsyncQuestionStore.setState((s) => {
    const sessions = { ...s.sessions };
    delete sessions[threadId];
    return { sessions };
  });
}
