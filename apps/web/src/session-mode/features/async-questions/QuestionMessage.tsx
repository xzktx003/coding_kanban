import { useSessionTabActions } from "../../hooks/useSessionTabs";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useQuestions } from "./useQuestions";
import { useAsyncQuestionStore } from "./store";
import type { Reply } from "./model";
import "./questions.css";

export function QuestionMessage({
  threadId,
  sourceId,
}: {
  threadId: string;
  sourceId: string;
}) {
  const { questions, session } = useQuestions(threadId);
  const group = questions.filter((q) => q.sourceId === sourceId);
  const { selectTab } = useSessionTabActions();
  if (!group.length) return null;
  const answered = group.every((q) => q.answer !== undefined);
  const pending = group.filter(
    (q) => q.answer === undefined && !session.drafts[q.id]?.skipped,
  ).length;
  return (
    <section
      className="session-async-message"
      data-async-thread={threadId}
      aria-label="Codex 问题"
    >
      <p className="session-async-caption">
        {answered
          ? "已回答"
          : pending
            ? `${pending} 个问题待回答`
            : "已跳过 · 可重新回答"}
      </p>
      {group.map((q) => (
        <div key={q.id}>
          <p>{q.title}</p>
          {q.answer !== undefined && (
            <p className="session-async-answer">你的回答：{q.answer}</p>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          // Opening a question is explicit navigation; async loading cannot later
          // overwrite the selected composer or auto-send anything.
          const tabs = useAgentCenterStore.getState();
          const card =
            tabs.cards.find((c) => c.kind === "codex" && c.id === threadId) ??
            (tabs.detachedCard?.id === threadId
              ? tabs.detachedCard
              : undefined);
          if (useCodexStore.getState().currentThreadId !== threadId && card)
            void selectTab(card);
          useAsyncQuestionStore.getState().open(threadId, group);
        }}
      >
        {answered ? "修改回答" : "回答问题"}
      </button>
    </section>
  );
}

export function AnswerMessage({ replies }: { replies: Reply[] }) {
  return (
    <div className="session-async-reply" aria-label="已发送的回答">
      {replies.map((r, i) => (
        <div key={`${r.questionItemId}-${i}`}>
          <p className="session-async-caption">{r.question}</p>
          <p>{r.answer}</p>
        </div>
      ))}
    </div>
  );
}
