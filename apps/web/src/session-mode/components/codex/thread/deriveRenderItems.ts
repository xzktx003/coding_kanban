import type { ServerNotification } from "@session/bindings";
import { isTranscriptMetadataOnly } from "../presentation/transcriptMetadata";
import type {
  CommandAction,
  ThreadItem,
  TurnStatus,
} from "@session/bindings/v2";

export type CommandActionSource = {
  commandItemId: string;
  aggregatedOutput: string | null;
  threadId?: string;
  turnId?: string;
  cwd?: string;
  status?: string;
  durationMs?: number | null;
  startedAtMs?: number | null;
  exitCode?: number | null;
  termination?: TurnStatus;
  transcriptMetadataOnly?: boolean;
};

/** Intermediate render item: either a raw event or an aggregated command group. */
export type RenderItem =
  | { kind: "event"; event: ServerNotification; index: number }
  | {
      kind: "cmdGroup";
      actions: CommandAction[];
      actionSources: CommandActionSource[];
      key: string;
      completed: boolean;
    };

/** Group contiguous commands, preserving their order around other visible items. */
export function deriveRenderItems(events: ServerNotification[]): RenderItem[] {
  const items: RenderItem[] = [];
  let cmdBuffer: CommandAction[] = [];
  let actionSources: CommandActionSource[] = [];
  let cmdBufferKey = "";
  const sourcesById = new Map<string, CommandActionSource>();
  const sourcesByTurn = new Map<string, Set<string>>();
  const finalized = new Set<string>();
  const keyOf = (thread: string, turn: string, item: string) =>
    JSON.stringify([thread, turn, item]);
  const addCommand = (
    event: Extract<
      ServerNotification,
      { method: "item/started" | "item/completed" }
    >,
  ) => {
    const item = event.params.item;
    if (item.type !== "commandExecution") return;
    if (cmdBuffer.length === 0)
      cmdBufferKey = `cmd-${keyOf(event.params.threadId, event.params.turnId, item.id)}`;
    const actions = item.commandActions.length
      ? item.commandActions
      : [{ type: "unknown" as const, command: item.command }];
    const source: CommandActionSource = {
      commandItemId: item.id,
      aggregatedOutput: item.aggregatedOutput ?? null,
      threadId: event.params.threadId,
      turnId: event.params.turnId,
      cwd: item.cwd,
      status: item.status,
      durationMs: item.durationMs,
      startedAtMs:
        event.method === "item/started" &&
        Number.isFinite(event.params.startedAtMs) &&
        event.params.startedAtMs > 0
          ? event.params.startedAtMs
          : null,
      exitCode: item.exitCode,
      ...(isTranscriptMetadataOnly(item)
        ? { transcriptMetadataOnly: true }
        : {}),
    };
    const key = keyOf(event.params.threadId, event.params.turnId, item.id);
    sourcesById.set(key, source);
    const turn = JSON.stringify([event.params.threadId, event.params.turnId]);
    const keys = sourcesByTurn.get(turn) ?? new Set<string>();
    keys.add(key);
    sourcesByTurn.set(turn, keys);
    cmdBuffer.push(...actions);
    actionSources.push(...actions.map(() => source));
    return source;
  };

  const finishTurn = (
    threadId: string,
    turnId: string,
    status: TurnStatus,
    finalItems: ThreadItem[] = [],
  ) => {
    const snapshots = new Map(
      finalItems
        .filter((item) => item.type === "commandExecution")
        .map((item) => [item.id, item]),
    );
    for (const key of sourcesByTurn.get(JSON.stringify([threadId, turnId])) ??
      []) {
      const source = sourcesById.get(key)!;
      const item = snapshots.get(source.commandItemId);
      if (item)
        Object.assign(source, {
          aggregatedOutput: item.aggregatedOutput,
          status: item.status,
          durationMs: item.durationMs,
          exitCode: item.exitCode,
          transcriptMetadataOnly: isTranscriptMetadataOnly(item),
        });
      if (
        !finalized.has(key) &&
        (source.status === "inProgress" || !source.status)
      )
        source.termination = status;
      finalized.add(key);
    }
  };

  const flushCmdBuffer = (completed: boolean) => {
    if (cmdBuffer.length === 0) return;
    items.push({
      kind: "cmdGroup",
      actions: cmdBuffer,
      actionSources,
      key: cmdBufferKey,
      completed,
    });
    cmdBuffer = [];
    actionSources = [];
    cmdBufferKey = "";
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Accumulate commandExecution into buffer — never flush here.
    if (
      event.method === "item/started" &&
      event.params.item.type === "commandExecution"
    ) {
      if (
        !sourcesById.has(
          keyOf(
            event.params.threadId,
            event.params.turnId,
            event.params.item.id,
          ),
        )
      )
        addCommand(event);
      continue;
    }

    // Capture aggregatedOutput from completed commandExecution.
    if (
      event.method === "item/completed" &&
      event.params.item.type === "commandExecution"
    ) {
      const commandOutput = event.params.item.aggregatedOutput ?? null;
      const commandId = event.params.item.id;
      // These references are local to this derivation. Updating once keeps all
      // actions of the command aligned, including completion after a flush.
      const source =
        sourcesById.get(
          keyOf(event.params.threadId, event.params.turnId, commandId),
        ) ?? addCommand(event);
      if (source) {
        Object.assign(source, {
          aggregatedOutput: commandOutput,
          status: event.params.item.status,
          durationMs: event.params.item.durationMs,
          exitCode: event.params.item.exitCode,
          transcriptMetadataOnly: isTranscriptMetadataOnly(event.params.item),
        });
        delete source.termination;
      }
      finalized.add(
        keyOf(event.params.threadId, event.params.turnId, commandId),
      );
      continue;
    }

    if (event.method === "item/commandExecution/outputDelta") {
      const source = sourcesById.get(
        keyOf(event.params.threadId, event.params.turnId, event.params.itemId),
      );
      if (
        source &&
        typeof event.params.delta === "string" &&
        !finalized.has(
          keyOf(
            event.params.threadId,
            event.params.turnId,
            event.params.itemId,
          ),
        )
      )
        source.aggregatedOutput =
          (source.aggregatedOutput ?? "") + event.params.delta;
      continue;
    }

    // Started or completed-only visible items delimit command slices. Later
    // lifecycle/delta updates retain the source reference in their original slice.
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      event.params.item.type !== "sleep" &&
      (event.params.item.type !== "reasoning" ||
        event.params.item.summary.some(Boolean))
    ) {
      flushCmdBuffer(true);
      items.push({ kind: "event", event, index: i });
      continue;
    }

    // turn/completed = boundary, flush then push.
    if (event.method === "turn/completed") {
      if (event.params.turn.status && event.params.turn.status !== "inProgress")
        finishTurn(
          event.params.threadId,
          event.params.turn.id,
          event.params.turn.status,
          event.params.turn.items,
        );
      flushCmdBuffer(true);
      items.push({ kind: "event", event, index: i });
      continue;
    }

    if (
      event.method === "error" &&
      !event.params.willRetry &&
      event.params.turnId
    ) {
      finishTurn(event.params.threadId, event.params.turnId, "failed");
      flushCmdBuffer(true);
    }

    if (
      event.method === "warning" ||
      event.method === "turn/plan/updated" ||
      event.method === "item/commandExecution/terminalInteraction" ||
      event.method === "item/autoApprovalReview/started" ||
      event.method === "item/autoApprovalReview/completed" ||
      event.method === "guardianWarning" ||
      event.method === "model/rerouted"
    )
      flushCmdBuffer(true);

    // Status, output and other invisible notifications do not split activity.
    items.push({ kind: "event", event, index: i });
  }

  // Flush trailing buffer (agent still running — not completed yet).
  flushCmdBuffer(false);
  return items;
}
