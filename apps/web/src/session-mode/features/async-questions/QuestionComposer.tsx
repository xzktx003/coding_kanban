import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useQuestions } from "./useQuestions";
import { useAsyncQuestionStore } from "./store";
import { answerTarget, reconcileAnswers, sendAnswers } from "./service";
import "./questions.css";

export function QuestionComposer({
  threadId,
  children,
  compact = false,
}: {
  compact?: boolean;
  threadId: string;
  children: ReactNode;
}) {
  const { questions, session, pending } = useQuestions(threadId);
  // Subscribe to timing even when the question message itself has not changed.
  useCodexStore((s) => s.turnTimingMap[threadId]);
  useCodexStore((s) => s.threadStatusMap[threadId]);
  const target = answerTarget(threadId);
  const current = questions.find((q) => q.id === session.openId);
  const group = current
    ? questions.filter((q) => q.sourceId === current.sourceId)
    : [];
  const index = current ? group.findIndex((q) => q.id === current.id) : -1;
  const patch = useAsyncQuestionStore((s) => s.patch),
    edit = useAsyncQuestionStore((s) => s.edit);
  const [height, setHeight] = useState(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setHeight(viewport?.height ?? window.innerHeight);
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (session.openId && !current && !session.sending)
      patch(threadId, { openId: undefined });
  }, [session.openId, !!current, session.sending, patch, threadId]);
  useEffect(() => {
    if (current) root.current?.focus({ preventScroll: true });
  }, [current?.id]);
  const close = () => patch(threadId, { openId: undefined });
  const openPending = () => {
    const first = pending[0];
    if (first)
      useAsyncQuestionStore.getState().open(
        threadId,
        questions.filter((q) => q.sourceId === first.sourceId),
        first.id,
      );
  };
  if (!current && compact)
    return (
      <div className="session-async-composer session-compact-question-container">
        <div>{children}</div>
      </div>
    );
  if (!current)
    return (
      <div className="session-async-composer">
        {pending.length > 0 && (
          <button
            type="button"
            className="session-async-notice"
            onClick={openPending}
          >
            <span>
              {target ? "运行中 · " : ""}有 {pending.length} 个问题待回答
            </span>
            <span>回答</span>
          </button>
        )}
        {children}
      </div>
    );
  const draft = session.drafts[current.id];
  const value = draft?.text ?? current.answer ?? "";
  const isOption = current.options.includes(value);
  const remoteChanged =
    !!draft &&
    draft.baseline !== current.answer &&
    value !== (current.answer ?? "");
  const disabled = session.sending || !!session.uncertain;
  const last = index === group.length - 1;
  const send = () => {
    if (target !== undefined)
      void sendAnswers(threadId, current.sourceId, target);
  };
  const submittedCount = group.filter((q) => {
    const d = session.drafts[q.id];
    return d && !d.skipped && d.text.trim();
  }).length;
  const skip = () => {
    edit(threadId, current, "", true);
    if (!last) patch(threadId, { openId: group[index + 1].id });
    else if (submittedCount <= (draft?.text.trim() ? 1 : 0)) close();
  };
  const panel = (
    <div
      ref={root}
      className="session-async-panel"
      data-session-async-panel
      style={{ maxHeight: Math.max(180, Math.min(440, height - 140)) }}
      role="region"
      tabIndex={-1}
      aria-label="回答 Codex 问题"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !session.sending) {
          e.preventDefault();
          close();
        }
      }}
    >
      <header>
        <strong>回答问题</strong>
        <span className="session-async-caption">
          {index + 1} / {group.length}
        </span>
        <span className="session-async-spacer" />
        <button type="button" onClick={close} disabled={session.sending}>
          收起
        </button>
      </header>
      <div className="session-async-body" key={current.id}>
        <p id="session-async-question-title" className="session-async-title">
          {current.title}
        </p>
        {target === null && (
          <p className="session-async-caption">
            本轮已结束，提交回答后继续会话。
          </p>
        )}
        {target === undefined && (
          <p role="status" className="session-async-caption">
            正在同步任务状态，稍后即可提交。
          </p>
        )}
        {remoteChanged && (
          <p role="status" className="session-async-warning">
            此问题已有新回答。已保留你的草稿，提交将发送更新。
          </p>
        )}
        <div role="radiogroup" aria-labelledby="session-async-question-title">
          {current.options.map((option, i) => (
            <label className="session-async-option" key={`${i}-${option}`}>
              <input
                type="radio"
                name={`async-${threadId}-${current.id}`}
                checked={isOption && value === option}
                disabled={disabled}
                onChange={() => edit(threadId, current, option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <label className="session-async-custom">
          {current.options.length ? "或者，填写自己的回答" : "你的回答"}
          <textarea
            value={isOption ? "" : value}
            disabled={disabled}
            placeholder="输入你的想法…"
            onChange={(e) => edit(threadId, current, e.target.value)}
            rows={2}
          />
        </label>
        {draft?.skipped && (
          <p className="session-async-caption">已跳过此题；仍可重新填写。</p>
        )}
        {session.error && (
          <p role="alert" className="session-async-warning">
            {session.error}
          </p>
        )}
        {session.uncertain && (
          <button
            type="button"
            disabled={session.sending}
            onClick={() => void reconcileAnswers(threadId)}
          >
            核对发送结果
          </button>
        )}
      </div>
      <footer>
        <button
          type="button"
          disabled={index === 0 || session.sending}
          onClick={() => patch(threadId, { openId: group[index - 1].id })}
        >
          上一题
        </button>
        <button type="button" disabled={disabled} onClick={skip}>
          跳过
        </button>
        <span className="session-async-spacer" />
        <button
          className="session-async-submit"
          type="button"
          disabled={
            disabled ||
            target === undefined ||
            (last ? submittedCount === 0 : !value.trim())
          }
          onClick={() =>
            last ? send() : patch(threadId, { openId: group[index + 1].id })
          }
        >
          {session.sending
            ? "正在提交…"
            : !last
              ? "下一题"
              : target === null
                ? "发送回答并继续"
                : group.some((q) => q.answer !== undefined)
                  ? "发送更新"
                  : submittedCount < group.length
                    ? `提交 ${submittedCount} 项回答`
                    : "提交回答"}
        </button>
      </footer>
    </div>
  );
  return compact ? (
    <div className="session-async-composer session-compact-question-container">
      <div inert>{children}</div>
      <div className="session-async-question-overlay">{panel}</div>
    </div>
  ) : (
    panel
  );
}
