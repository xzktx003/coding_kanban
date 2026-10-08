import type { ServerNotification } from "../../bindings";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { isAgentInteractionVisible } from "../../session-dom";
import { useAgentSettingsStore } from "../../stores/useAgentSettingsStore";
import { useAcpStore } from "../../stores/useAcpStore";
import { collectQuestions, latestQuestionTurn, readQuestions } from "./model";
import { useAsyncQuestionStore } from "./store";

/** Only the live notification path opens a panel. History hydration is passive.
 * The prior transcript deduplicates started/completed/reconnect replay, including
 * after the user has explicitly collapsed the panel. */
export function revealNewQuestion(
  event: ServerNotification,
  previousEvents: ServerNotification[],
) {
  if (event.method !== "item/started" && event.method !== "item/completed")
    return;
  const incoming = readQuestions(event.params.item);
  if (!incoming.length) return;
  const { threadId, turnId } = event.params;
  const state = useCodexStore.getState();
  if (
    state.currentThreadId !== threadId ||
    !state.historyLoadedMap[threadId] ||
    !isAgentInteractionVisible() ||
    useAgentSettingsStore.getState().selectedAgent !== "codex" ||
    useAcpStore.getState().active
  )
    return;
  const latestTurn = latestQuestionTurn(
    state.events[threadId] ?? [],
    threadId,
    state.turnTimingMap[threadId]?.turnId ?? state.currentTurnId,
  );
  if (turnId !== latestTurn) return;
  const previous = collectQuestions(previousEvents, threadId);
  if (previous.some((q) => q.sourceId === event.params.item.id)) return;
  const session = useAsyncQuestionStore.getState().sessions[threadId];
  if (session?.presentedSources?.includes(event.params.item.id)) return;
  // Don't replace a partially answered batch or an unresolved submission.
  if (session?.openId || session?.sending || session?.uncertain) return;
  const questions = collectQuestions(
    state.events[threadId] ?? [],
    threadId,
  ).filter((q) => q.sourceId === event.params.item.id);
  if (questions.length && questions.some((q) => q.answer === undefined)) {
    useAsyncQuestionStore.getState().patch(threadId, {
      presentedSources: [
        ...(session?.presentedSources ?? []),
        event.params.item.id,
      ],
    });
    useAsyncQuestionStore.getState().open(threadId, questions);
  }
}
