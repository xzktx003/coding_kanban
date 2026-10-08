import type { ServerNotification } from "@session/bindings";
import type { CommandAction } from "@session/bindings/v2";

export type CommandActionSource = {
  commandItemId: string;
  aggregatedOutput: string | null;
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

/** Pre-process events into render items, grouping commandExecution runs between agentMessages. */
export function deriveRenderItems(events: ServerNotification[]): RenderItem[] {
  const items: RenderItem[] = [];
  let cmdBuffer: CommandAction[] = [];
  let actionSources: CommandActionSource[] = [];
  let cmdBufferKey = "";
  const sourcesById = new Map<string, CommandActionSource>();

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
      if (cmdBuffer.length === 0) {
        cmdBufferKey = `cmd-${event.params.turnId}-${event.params.item.id}`;
      }
      const actions = event.params.item.commandActions as CommandAction[];
      const visibleActions = actions.length
        ? actions
        : [{ type: "unknown" as const, command: event.params.item.command }];
      cmdBuffer.push(...visibleActions);
      const source: CommandActionSource = {
        commandItemId: event.params.item.id,
        aggregatedOutput: null,
      };
      sourcesById.set(source.commandItemId, source);
      actionSources.push(...visibleActions.map(() => source));
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
      const source = sourcesById.get(commandId);
      if (source) source.aggregatedOutput = commandOutput;
      continue;
    }

    // agentMessage started = flush commands that came before it (completed).
    if (
      event.method === "item/started" &&
      event.params.item.type === "agentMessage"
    ) {
      flushCmdBuffer(true);
      items.push({ kind: "event", event, index: i });
      continue;
    }

    // agentMessage completed = just push (content rendered here).
    if (
      event.method === "item/completed" &&
      event.params.item.type === "agentMessage"
    ) {
      items.push({ kind: "event", event, index: i });
      continue;
    }

    // turn/completed = boundary, flush then push.
    if (event.method === "turn/completed") {
      flushCmdBuffer(true);
      items.push({ kind: "event", event, index: i });
      continue;
    }

    // Everything else: just push, never flush.
    items.push({ kind: "event", event, index: i });
  }

  // Flush trailing buffer (agent still running — not completed yet).
  flushCmdBuffer(false);
  return items;
}
