import type { Thread } from "@session/bindings/v2/Thread";
import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2/ThreadItem";

// This is a chat projection, not a protocol filter: subagent observation and
// pending approvals/questions must consume their events before this boundary.
const toolItemTypes = new Set<ThreadItem["type"]>([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageView",
  "imageGeneration",
]);
const toolMethods = new Set<ServerNotification["method"]>([
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "turn/diff/updated",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
]);

export const isToolTranscriptItem = (item: ThreadItem): boolean =>
  toolItemTypes.has(item.type);
export const isToolTranscriptEvent = (event: ServerNotification): boolean =>
  toolMethods.has(event.method) ||
  ((event.method === "item/started" || event.method === "item/completed") &&
    isToolTranscriptItem(event.params.item));

export function withoutToolTranscriptEvent(
  event: ServerNotification,
): ServerNotification | null {
  if (isToolTranscriptEvent(event)) return null;
  if (event.method === "turn/started" || event.method === "turn/completed") {
    const originalItems = event.params.turn?.items ?? [];
    const items = originalItems.filter((item) => !isToolTranscriptItem(item));
    if (items.length !== originalItems.length)
      return {
        ...event,
        params: { ...event.params, turn: { ...event.params.turn, items } },
      } as ServerNotification;
  }
  if (event.method === "thread/started") {
    let changed = false;
    const turns = (event.params.thread?.turns ?? []).map((turn) => {
      const items = turn.items.filter((item) => !isToolTranscriptItem(item));
      if (items.length === turn.items.length) return turn;
      changed = true;
      return { ...turn, items };
    });
    if (changed)
      return {
        ...event,
        params: { ...event.params, thread: { ...event.params.thread, turns } },
      };
  }
  return event;
}

export function withoutToolTranscriptEvents(
  events: ServerNotification[],
): ServerNotification[] {
  let changed = false;
  const visible: ServerNotification[] = [];
  for (const event of events) {
    const next = withoutToolTranscriptEvent(event);
    changed ||= next !== event;
    if (next) visible.push(next);
  }
  return changed ? visible : events;
}

// Store turn metadata once; chat bodies have their own filtered event projection.
export const lightweightThreadForStore = (thread: Thread): Thread => {
  if (thread.turns.every((turn) => turn.items.length === 0)) return thread;
  return {
    ...thread,
    turns: thread.turns.map((turn) =>
      turn.items.length === 0 ? turn : { ...turn, items: [] },
    ),
  };
};
