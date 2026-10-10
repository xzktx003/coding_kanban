import { isToolTranscriptItem } from "@session/services/codexTranscriptVisibility";
import type { ServerNotification } from "@session/bindings";
import type { Thread } from "@session/bindings/v2";

/**
 * Converts thread history (turns with items) to ChatEvents for display
 * Keeps user conversation and turn lifecycle events, with one event for finalized
 * agent messages and body-light boundaries for finalized turns.
 */
export function convertThreadHistoryToEvents(
  thread: Thread,
): ServerNotification[] {
  const events: ServerNotification[] = [];

  // Process each turn in the thread
  for (const turn of thread.turns) {
    const isCompletedTurn = turn.status !== "inProgress";

    // Process each item in the turn
    for (const item of turn.items) {
      if (isToolTranscriptItem(item)) continue;
      // Add item/started event. Completed agent messages render from their
      // final item/completed snapshot; keeping a started copy only retains a
      // redundant reference to the same text/questions.
      if (!(isCompletedTurn && item.type === "agentMessage")) {
        events.push({
          method: "item/started",
          params: {
            item: item,
            threadId: thread.id,
            turnId: turn.id,
            startedAtMs: 0,
          },
        });
      }

      // Add item/completed event immediately after
      // This allows the UI to render both the start state and final state
      events.push({
        method: "item/completed",
        params: {
          item: item,
          threadId: thread.id,
          turnId: turn.id,
          completedAtMs: 0,
        },
      });
    }

    // Mark the turn boundary so the UI flushes per-turn state (e.g. trailing
    // commandExecution groups in deriveRenderItems) instead of bleeding into
    // the next turn's items.
    events.push({
      method: "turn/completed",
      params: {
        threadId: thread.id,
        turn: {
          ...turn,
          items: isCompletedTurn
            ? []
            : turn.items.filter((item) => !isToolTranscriptItem(item)),
        },
      },
    });
  }

  return events;
}
