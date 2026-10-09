import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2/ThreadItem";
import {
  compactCodexEventPayload,
  estimateTranscriptBytes,
} from "@session/services/codexTranscriptMemoryBudget";
import { recordTranscriptTraffic } from "@session/services/sessionMemoryPressure";

type DeltaMethod =
  | "item/agentMessage/delta"
  | "item/plan/delta"
  | "item/reasoning/summaryTextDelta"
  | "item/reasoning/textDelta";

export type DeltaEvent = Extract<ServerNotification, { method: DeltaMethod }>;
type ItemCompletedEvent = Extract<
  ServerNotification,
  { method: "item/completed" }
>;
type ItemStartedEvent = Extract<ServerNotification, { method: "item/started" }>;
type ItemLifecycleEvent = ItemStartedEvent | ItemCompletedEvent;
type TurnCompletedEvent = Extract<
  ServerNotification,
  { method: "turn/completed" }
>;

const ignoredTranscriptMethods = new Set<ServerNotification["method"]>([
  "rawResponseItem/completed",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
]);

export const isIgnoredTranscriptEvent = (event: ServerNotification): boolean =>
  ignoredTranscriptMethods.has(event.method);

export const isDeltaEvent = (
  event: ServerNotification,
): event is DeltaEvent => {
  return [
    "item/agentMessage/delta",
    "item/plan/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
  ].includes(event.method);
};

const canCompactDeltaEvents = (
  previous: DeltaEvent,
  incoming: DeltaEvent,
): boolean => {
  if (previous.method !== incoming.method) {
    return false;
  }

  const left = previous.params as typeof previous.params & {
    summaryIndex?: number;
    contentIndex?: number;
  };
  const right = incoming.params as typeof incoming.params & {
    summaryIndex?: number;
    contentIndex?: number;
  };
  return (
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.itemId === right.itemId &&
    left.summaryIndex === right.summaryIndex &&
    left.contentIndex === right.contentIndex
  );
};

const lastEventIndex = (
  events: ServerNotification[],
  predicate: (event: ServerNotification) => boolean,
): number => {
  for (let index = events.length - 1; index >= 0; index--)
    if (predicate(events[index])) return index;
  return -1;
};
export const compactDeltaEvents = (
  events: ServerNotification[],
  incoming: ServerNotification,
): ServerNotification[] => {
  if (!isDeltaEvent(incoming)) return [...events, incoming];
  const previousIndex = lastEventIndex(
    events,
    (event) => isDeltaEvent(event) && canCompactDeltaEvents(event, incoming),
  );
  const previous = events[previousIndex];
  if (previousIndex < 0 || !previous || !isDeltaEvent(previous))
    return [...events, incoming];

  const compacted = {
    ...incoming,
    params: {
      ...incoming.params,
      delta: `${previous.params.delta}${incoming.params.delta}`,
    },
  } as ServerNotification;

  const next = [...events];
  next[previousIndex] = compacted;
  return next;
};

const itemEventKey = (
  threadId: string,
  turnId: string,
  itemId: string,
): string => `${threadId}:${turnId}:${itemId}`;

const keyOfItemEvent = (event: ServerNotification): string | null => {
  if (event.method === "item/started" || event.method === "item/completed") {
    return itemEventKey(
      event.params.threadId,
      event.params.turnId,
      event.params.item.id,
    );
  }
  if ("itemId" in event.params) {
    return itemEventKey(
      "threadId" in event.params ? event.params.threadId : "",
      "turnId" in event.params ? event.params.turnId : "",
      event.params.itemId,
    );
  }
  return null;
};

const isAgentMessageCompleted = (
  event: ServerNotification,
): event is ItemCompletedEvent =>
  event.method === "item/completed" &&
  event.params.item.type === "agentMessage";

const isCommandExecutionLifecycle = (event: ServerNotification): boolean =>
  (event.method === "item/started" || event.method === "item/completed") &&
  event.params.item.type === "commandExecution";

const replaceCommandExecutionSnapshot = (
  events: ServerNotification[],
  incoming: ItemLifecycleEvent,
): ServerNotification[] => {
  const incomingKey = keyOfItemEvent(incoming);
  if (!incomingKey) return [...events, incoming];

  const completedIndex = lastEventIndex(
    events,
    (event) =>
      event.method === "item/completed" &&
      keyOfItemEvent(event) === incomingKey &&
      event.params.item.type === "commandExecution",
  );
  if (completedIndex >= 0) {
    if (incoming.method === "item/started") return events;
    const next = [...events];
    next[completedIndex] = incoming;
    return next;
  }

  const startedIndex = lastEventIndex(
    events,
    (event) =>
      event.method === "item/started" &&
      keyOfItemEvent(event) === incomingKey &&
      event.params.item.type === "commandExecution",
  );
  if (startedIndex >= 0) {
    const next = [...events];
    next[startedIndex] = incoming;
    return next;
  }

  return [...events, incoming];
};

const replaceAgentStreamWithCompleted = (
  events: ServerNotification[],
  incoming: ItemCompletedEvent,
): ServerNotification[] => {
  const incomingKey = keyOfItemEvent(incoming);
  if (!incomingKey) return [...events, incoming];

  let inserted = false;
  const next: ServerNotification[] = [];
  for (const event of events) {
    const key = keyOfItemEvent(event);
    const sameItem = key === incomingKey;
    if (
      sameItem &&
      ((event.method === "item/started" &&
        event.params.item.type === "agentMessage") ||
        event.method === "item/agentMessage/delta")
    ) {
      if (!inserted) {
        next.push(incoming);
        inserted = true;
      }
      continue;
    }
    if (
      sameItem &&
      event.method === "item/completed" &&
      event.params.item.type === "agentMessage"
    ) {
      if (!inserted) {
        next.push(incoming);
        inserted = true;
      }
      continue;
    }
    next.push(event);
  }
  if (!inserted) next.push(incoming);
  return next;
};

const hasLifecycleItemNotification = (
  events: ServerNotification[],
  threadId: string,
  turnId: string,
  itemId: string,
): boolean => {
  const key = itemEventKey(threadId, turnId, itemId);
  return events.some(
    (event) =>
      keyOfItemEvent(event) === key &&
      (event.method === "item/started" || event.method === "item/completed"),
  );
};

const hasCompletedItemNotification = (
  events: ServerNotification[],
  threadId: string,
  turnId: string,
  itemId: string,
): boolean => {
  const key = itemEventKey(threadId, turnId, itemId);
  return events.some(
    (event) =>
      keyOfItemEvent(event) === key && event.method === "item/completed",
  );
};

const shouldMaterializeTurnItem = (
  events: ServerNotification[],
  threadId: string,
  turnId: string,
  item: ThreadItem,
): boolean => {
  if (item.type === "userMessage") {
    return !hasLifecycleItemNotification(events, threadId, turnId, item.id);
  }
  return !hasCompletedItemNotification(events, threadId, turnId, item.id);
};

const itemCompletedFromTurn = (
  event: TurnCompletedEvent,
  item: ThreadItem,
): ItemCompletedEvent => ({
  method: "item/completed",
  params: {
    threadId: event.params.threadId,
    turnId: event.params.turn.id,
    item,
    completedAtMs: event.params.turn.completedAt
      ? event.params.turn.completedAt * 1000
      : 0,
  },
});

const stripTurnItems = (event: TurnCompletedEvent): TurnCompletedEvent => ({
  ...event,
  params: {
    ...event.params,
    turn: {
      ...event.params.turn,
      items: [],
    },
  },
});

const appendTurnCompleted = (
  events: ServerNotification[],
  incoming: TurnCompletedEvent,
): ServerNotification[] => {
  let next = events;
  for (const item of incoming.params.turn.items) {
    if (
      !shouldMaterializeTurnItem(
        next,
        incoming.params.threadId,
        incoming.params.turn.id,
        item,
      )
    ) {
      continue;
    }
    next = appendTranscriptEvent(next, itemCompletedFromTurn(incoming, item));
  }
  return compactDeltaEvents(next, stripTurnItems(incoming));
};

export const appendTranscriptEvent = (
  events: ServerNotification[],
  incoming: ServerNotification,
): ServerNotification[] => {
  if (isIgnoredTranscriptEvent(incoming)) return events;
  recordTranscriptTraffic(estimateTranscriptBytes(incoming));
  incoming = compactCodexEventPayload(incoming);
  const incomingItemKey = keyOfItemEvent(incoming);
  if (
    isDeltaEvent(incoming) &&
    incomingItemKey &&
    events.some(
      (event) =>
        event.method === "item/completed" &&
        keyOfItemEvent(event) === incomingItemKey,
    )
  )
    return events;
  if (isCommandExecutionLifecycle(incoming)) {
    return replaceCommandExecutionSnapshot(
      events,
      incoming as ItemLifecycleEvent,
    );
  }
  if (
    (incoming.method === "item/started" ||
      incoming.method === "item/completed") &&
    incoming.params.item.type !== "agentMessage"
  ) {
    const index = lastEventIndex(
      events,
      (event) =>
        event.method === incoming.method &&
        keyOfItemEvent(event) === incomingItemKey,
    );
    if (index >= 0) {
      const next = [...events];
      next[index] = incoming;
      return next;
    }
  }

  if (
    [
      "turn/plan/updated",
      "item/mcpToolCall/progress",
      "item/fileChange/patchUpdated",
    ].includes(incoming.method)
  ) {
    const p = incoming.params as {
      threadId?: string;
      turnId?: string;
      itemId?: string;
    };
    const index = lastEventIndex(events, (event) => {
      const before = event.params as typeof p;
      return (
        event.method === incoming.method &&
        before.threadId === p.threadId &&
        before.turnId === p.turnId &&
        before.itemId === p.itemId
      );
    });
    if (index >= 0) {
      const next = [...events];
      next[index] = incoming;
      return next;
    }
  }
  if (isAgentMessageCompleted(incoming)) {
    return replaceAgentStreamWithCompleted(events, incoming);
  }
  if (incoming.method === "turn/completed") {
    return appendTurnCompleted(events, incoming);
  }
  return compactDeltaEvents(events, incoming);
};
