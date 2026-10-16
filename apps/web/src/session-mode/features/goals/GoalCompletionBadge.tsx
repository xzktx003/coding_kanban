import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ServerNotification } from "@session/bindings";
import type { ThreadGoal, Turn } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import {
  projectGoalCompletion,
  type GoalCompletionTarget,
} from "./goalCompletion";
import { goalDuration } from "./goalPresentation";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import "./goalCompletion.css";

const EMPTY_EVENTS: ServerNotification[] = [];
const EMPTY_TURNS: Turn[] = [];
const GoalCompletionContext = createContext<{
  threadId: string;
  goal: ThreadGoal | undefined;
  target: GoalCompletionTarget | null;
} | null>(null);

export function useGoalCompletionTarget(
  threadId: string,
): GoalCompletionTarget | null {
  const value = useContext(GoalCompletionContext);
  return value?.threadId === threadId ? value.target : null;
}

export function GoalCompletionFallback({
  threadId,
  turnId,
}: {
  threadId: string;
  turnId: string;
}) {
  const target = useGoalCompletionTarget(threadId);
  const focused = useWindowFocus();
  if (target?.turnId !== turnId || target.itemId !== null) return null;
  return (
    <div
      className="codex-assistant group"
      data-goal-completion-fallback={turnId}
    >
      <div
        className={`session-message-actions codex-message-native-actions ${
          focused
            ? "invisible group-hover:visible group-focus-within:visible"
            : "invisible"
        }`}
      >
        <GoalCompletionBadge
          threadId={threadId}
          turnId={turnId}
          itemId={null}
        />
      </div>
    </div>
  );
}

/** Mounted with the visible transcript, so dormant views retain no body consumers. */
export function GoalCompletionScope({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const goal = useCodexStore((state) => state.completedGoalMap[threadId]);
  const events = useCodexStore(
    (state) => state.events[threadId] ?? EMPTY_EVENTS,
  );
  const turns = useCodexStore(
    (state) =>
      state.threads.find((thread) => thread.id === threadId)?.turns ??
      EMPTY_TURNS,
  );
  const target = useMemo(
    () => projectGoalCompletion(threadId, goal, events, turns),
    [threadId, goal, events, turns],
  );
  const value = useMemo(
    () => ({ threadId, goal, target }),
    [threadId, goal, target],
  );
  return (
    <GoalCompletionContext.Provider value={value}>
      {children}
    </GoalCompletionContext.Provider>
  );
}

export function GoalCompletionBadge({
  threadId,
  turnId,
  itemId,
}: {
  threadId?: string;
  turnId?: string;
  itemId?: string | null;
}) {
  const completion = useContext(GoalCompletionContext);
  const { i18n } = useTranslation("thread");
  if (
    !completion?.goal ||
    !completion.target ||
    completion.threadId !== threadId ||
    completion.target.turnId !== turnId ||
    completion.target.itemId !== itemId
  )
    return null;
  const duration = goalDuration(completion.goal.timeUsedSeconds * 1000);
  const text = (i18n?.language ?? "zh").startsWith("zh")
    ? `已在 ${duration} 内达成目标`
    : `Goal achieved in ${duration}`;
  return (
    <span className="codex-goal-achieved" data-goal-achieved>
      <span className="codex-goal-achieved-separator" aria-hidden="true" />
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        data-goal-completion-icon="checkmark-circle-light-16"
      >
        <path d="M9.82617 5.80469C9.98754 5.56401 10.3139 5.49907 10.5547 5.66016C10.7953 5.82154 10.8603 6.14792 10.6992 6.38867L7.98633 10.4346C7.70821 10.8487 7.11681 10.896 6.77637 10.5312L5.35352 9.00684C5.15586 8.79497 5.16732 8.46249 5.37891 8.26465C5.59087 8.06689 5.92328 8.07816 6.12109 8.29004L7.30664 9.56152L9.82617 5.80469Z" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8 1.47461C11.6037 1.47461 14.5254 4.39634 14.5254 8C14.5254 11.6037 11.6037 14.5254 8 14.5254C4.39634 14.5254 1.47461 11.6037 1.47461 8C1.47461 4.39634 4.39634 1.47461 8 1.47461ZM8 2.52539C4.97624 2.52539 2.52539 4.97624 2.52539 8C2.52539 11.0238 4.97624 13.4746 8 13.4746C11.0238 13.4746 13.4746 11.0238 13.4746 8C13.4746 4.97624 11.0238 2.52539 8 2.52539Z"
        />
      </svg>
      {text}
    </span>
  );
}
