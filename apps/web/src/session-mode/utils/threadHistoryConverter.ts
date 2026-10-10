import { withoutToolTranscriptEvent } from "@session/services/codexTranscriptVisibility";
import { copyTranscriptText } from "@session/services/codexTranscriptMemoryBudget";
import type { ServerNotification } from "@session/bindings";
import type { Thread } from "@session/bindings/v2";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function integer(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return BigInt(value);
  if (typeof value === "string" && /^\d{1,20}$/.test(value))
    return BigInt(value);
  return null;
}
/** Older/native runtime versions may include this public metadata as an extra Turn field. */
function actualHistoryHookRun(value: unknown): HookRunSummary | null {
  const run = record(value);
  if (
    !run ||
    typeof run.id !== "string" ||
    !run.id.trim() ||
    typeof run.sourcePath !== "string" ||
    run.id.length > 4096 ||
    run.sourcePath.length > 4096 ||
    ![
      "preToolUse",
      "permissionRequest",
      "postToolUse",
      "preCompact",
      "postCompact",
      "sessionStart",
      "sessionEnd",
      "userPromptSubmit",
      "subagentStart",
      "subagentStop",
      "stop",
    ].includes(String(run.eventName)) ||
    !["command", "prompt", "agent"].includes(String(run.handlerType)) ||
    !["sync", "async"].includes(String(run.executionMode)) ||
    !["thread", "turn"].includes(String(run.scope)) ||
    !["running", "completed", "failed", "blocked", "stopped"].includes(
      String(run.status),
    ) ||
    ![
      "system",
      "user",
      "project",
      "mdm",
      "sessionFlags",
      "plugin",
      "cloudRequirements",
      "cloudManagedConfig",
      "legacyManagedConfigFile",
      "legacyManagedConfigMdm",
      "unknown",
    ].includes(String(run.source)) ||
    !(run.statusMessage === null || typeof run.statusMessage === "string") ||
    !Array.isArray(run.entries)
  )
    return null;
  const displayOrder = integer(run.displayOrder),
    startedAt = integer(run.startedAt),
    completedAt = run.completedAt === null ? null : integer(run.completedAt),
    durationMs = run.durationMs === null ? null : integer(run.durationMs);
  if (
    displayOrder === null ||
    startedAt === null ||
    (run.completedAt !== null && completedAt === null) ||
    (run.durationMs !== null && durationMs === null)
  )
    return null;
  const entries = run.entries.slice(0, 8).map(record);
  if (
    entries.some(
      (entry) =>
        !entry ||
        !["warning", "stop", "feedback", "context", "error"].includes(
          String(entry.kind),
        ) ||
        typeof entry.text !== "string",
    )
  )
    return null;
  let remainingText = 1024;
  const publicEntries = entries.map((entry) => {
    const text = copyTranscriptText(
      (entry!.text as string).slice(0, remainingText),
    );
    remainingText -= text.length;
    return { kind: entry!.kind, text };
  });
  return {
    id: run.id,
    eventName: run.eventName,
    handlerType: run.handlerType,
    executionMode: run.executionMode,
    scope: run.scope,
    sourcePath: run.sourcePath,
    source: run.source,
    displayOrder,
    status: run.status,
    statusMessage:
      run.statusMessage === null
        ? null
        : copyTranscriptText((run.statusMessage as string).slice(0, 1024)),
    startedAt,
    completedAt,
    durationMs,
    entries: publicEntries,
  } as HookRunSummary;
}

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
    const hookRuns = (turn as unknown as { hookRuns?: unknown }).hookRuns;
    if (Array.isArray(hookRuns))
      for (const value of hookRuns) {
        const run = actualHistoryHookRun(value);
        if (run)
          events.push({
            method:
              run.status === "running" ? "hook/started" : "hook/completed",
            params: { threadId: thread.id, turnId: turn.id, run },
          });
      }
    const visibleItems: typeof turn.items = [];
    // The shared projection retains only bounded native metadata; private
    // reasoning is also removed when restoring old persisted histories.
    for (const original of turn.items) {
      const item =
        original.type === "reasoning" ? { ...original, content: [] } : original;
      const completed = withoutToolTranscriptEvent({
        method: "item/completed",
        params: {
          item,
          threadId: thread.id,
          turnId: turn.id,
          completedAtMs: 0,
        },
      });
      if (!completed || completed.method !== "item/completed") continue;
      const safeItem = completed.params.item;
      visibleItems.push(safeItem);
      // Final assistant replies and embedded questions only retain one snapshot.
      if (!(isCompletedTurn && safeItem.type === "agentMessage")) {
        events.push({
          method: "item/started",
          params: {
            item: safeItem,
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
          item: safeItem,
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
          id: turn.id,
          itemsView: turn.itemsView,
          status: turn.status,
          error: turn.error,
          startedAt: turn.startedAt,
          completedAt: turn.completedAt,
          durationMs: turn.durationMs,
          // Hook runs and finalized bodies have already been materialized above.
          // Do not retain a second copy through arbitrary native Turn extensions.
          items: isCompletedTurn ? [] : visibleItems,
        },
      },
    });
  }

  return events;
}
