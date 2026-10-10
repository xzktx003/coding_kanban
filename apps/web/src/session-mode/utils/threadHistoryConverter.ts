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
  const entries = run.entries.map(record);
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
  return {
    ...run,
    displayOrder,
    startedAt,
    completedAt,
    durationMs,
    entries,
  } as HookRunSummary;
}

/**
 * Converts thread history (turns with items) to ChatEvents for display
 * For each item, we generate both item/started and item/completed events
 * to ensure proper rendering in the UI
 */
export function convertThreadHistoryToEvents(
  thread: Thread,
): ServerNotification[] {
  const events: ServerNotification[] = [];

  // Process each turn in the thread
  for (const turn of thread.turns) {
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
    // Process each item in the turn
    for (const item of turn.items) {
      // Add item/started event
      events.push({
        method: "item/started",
        params: {
          item: item,
          threadId: thread.id,
          turnId: turn.id,
          startedAtMs: 0,
        },
      });

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
        turn,
      },
    });
  }

  return events;
}
