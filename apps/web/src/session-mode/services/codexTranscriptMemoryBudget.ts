import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2/ThreadItem";

const estimateCache = new WeakMap<object, number>();
const OBJECT_OVERHEAD = 32;
const ARRAY_OVERHEAD = 24;
const TRUNCATION_MARKER = "\n...[truncated ";
const DISPLAY_PREVIEW_MARKER = "\n\n...[中间内容因会话内存限制已省略]...\n\n";
const DEFAULT_TOOL_TEXT_LIMIT = 64 * 1024;
const DEFAULT_STREAM_TEXT_LIMIT = 256 * 1024;
const DEFAULT_ACTIVE_TOOL_GROUPS = 256;
const HIDDEN_TRANSCRIPT_METHODS = new Set<ServerNotification["method"]>([
  "thread/name/updated",
  "thread/started",
  "thread/tokenUsage/updated",
  "thread/status/changed",
  "thread/goal/updated",
  "thread/goal/cleared",
  "turn/diff/updated",
  "rawResponseItem/completed",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "mcpServer/startupStatus/updated",
  "hook/started",
  "hook/completed",
]);

export interface CodexTranscriptBudgetOptions {
  maxBytes: number;
  maxEvents: number;
  targetBytes?: number;
  targetEvents?: number;
  activeTurnId?: string | null;
  protectedTurnIds?: ReadonlySet<string>;
  toolTextLimit?: number;
  maxActiveToolGroups?: number;
}

export interface CodexTranscriptBudgetResult {
  events: ServerNotification[];
  trimmed: boolean;
  evicted: boolean;
  trimmedEventCount: number;
  compactedPayloadCount: number;
  hiddenEventCount: number;
  sameTurnTrimmedEventCount: number;
  truncatedTurnIds: string[];
  oldestTurnId?: string;
  estimatedBytes: number;
}

export function estimateTranscriptBytes(value: unknown): number {
  return estimateValue(value, new WeakSet());
}

export const estimateTransientBytes = estimateTranscriptBytes;

function estimateValue(value: unknown, seen: WeakSet<object>): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length * 2 + 24;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value !== "object") return 16;
  const cached = estimateCache.get(value);
  if (cached !== undefined) return cached;
  if (seen.has(value)) return 0;
  seen.add(value);
  let total = Array.isArray(value) ? ARRAY_OVERHEAD : OBJECT_OVERHEAD;
  if (Array.isArray(value))
    for (const item of value) total += estimateValue(item, seen);
  else
    for (const [key, item] of Object.entries(value))
      total += key.length * 2 + estimateValue(item, seen);
  estimateCache.set(value, total);
  return total;
}

const truncateText = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  const marker = `${TRUNCATION_MARKER}${text.length - limit} chars]`;
  return `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`;
};

const truncateDisplayText = (text: string, limit: number): string => {
  const boundedLimit = Math.max(0, limit);
  if (text.length <= boundedLimit) return text;
  if (boundedLimit <= DISPLAY_PREVIEW_MARKER.length)
    return DISPLAY_PREVIEW_MARKER.slice(0, boundedLimit);
  const contentLimit = boundedLimit - DISPLAY_PREVIEW_MARKER.length;
  const headLimit = Math.floor(contentLimit * 0.75);
  const tailLimit = contentLimit - headLimit;
  const firstMarker = text.indexOf(DISPLAY_PREVIEW_MARKER);
  const lastMarker = text.lastIndexOf(DISPLAY_PREVIEW_MARKER);
  const head = firstMarker >= 0 ? text.slice(0, firstMarker) : text;
  const tail =
    lastMarker > firstMarker
      ? text.slice(lastMarker + DISPLAY_PREVIEW_MARKER.length)
      : firstMarker >= 0
        ? text.slice(firstMarker + DISPLAY_PREVIEW_MARKER.length)
        : text;
  return `${head.slice(0, headLimit)}${DISPLAY_PREVIEW_MARKER}${tail.slice(-tailLimit)}`;
};

type MutableRecord = Record<string, unknown>;
type ItemGroup = {
  turnId: string;
  itemId: string;
  indexes: number[];
  keep: boolean;
  assistant: boolean;
  started: boolean;
  completed: boolean;
  inProgress: boolean;
};

const terminalStatuses = new Set(["completed", "failed", "declined"]);

function compactJsonStrings(
  value: unknown,
  limit: number,
  seen = new WeakSet<object>(),
): [unknown, boolean] {
  if (typeof value === "string") {
    const text = truncateText(value, limit);
    return [text, text !== value];
  }
  if (value == null || typeof value !== "object") return [value, false];
  if (seen.has(value)) return [value, false];
  seen.add(value);
  let changed = false;
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      const [next, compacted] = compactJsonStrings(item, limit, seen);
      changed ||= compacted;
      return next;
    });
    return changed ? [items, true] : [value, false];
  }
  const next: MutableRecord = { ...(value as MutableRecord) };
  for (const [key, item] of Object.entries(next)) {
    const [compacted, compactedItem] = compactJsonStrings(item, limit, seen);
    if (compactedItem) {
      next[key] = compacted;
      changed = true;
    }
  }
  return changed ? [next, true] : [value, false];
}

const compactDiffChange = <T extends MutableRecord>(
  change: T,
  limit: number,
): [T, boolean] => {
  let changed = false;
  const next: MutableRecord = { ...change };
  for (const key of ["diff", "oldText", "newText"]) {
    if (typeof next[key] !== "string") continue;
    const text = truncateDisplayText(next[key], limit);
    if (text !== next[key]) {
      next[key] = text;
      changed = true;
    }
  }
  return changed ? [next as T, true] : [change, false];
};

const compactItem = (
  item: ThreadItem,
  limit: number,
): [ThreadItem, boolean] => {
  if (item?.type === "agentMessage" || item?.type === "plan") {
    const text = truncateDisplayText(item.text, DEFAULT_STREAM_TEXT_LIMIT);
    return text === item.text ? [item, false] : [{ ...item, text }, true];
  }
  if (item?.type === "reasoning") {
    let changed = false;
    const compactParts = (parts: string[]) =>
      parts.map((part) => {
        const text = truncateDisplayText(part, DEFAULT_STREAM_TEXT_LIMIT);
        changed ||= text !== part;
        return text;
      });
    const summary = compactParts(item.summary);
    const content = compactParts(item.content);
    return changed ? [{ ...item, summary, content }, true] : [item, false];
  }
  if (
    item?.type === "commandExecution" &&
    typeof item.aggregatedOutput === "string"
  ) {
    const output = truncateText(item.aggregatedOutput, limit);
    return output === item.aggregatedOutput
      ? [item, false]
      : [{ ...item, aggregatedOutput: output }, true];
  }
  if (item?.type === "fileChange" && Array.isArray(item.changes)) {
    let changed = false;
    const changes = item.changes.map((change) => {
      const [next, compacted] = compactDiffChange(change, limit);
      changed ||= compacted;
      return next;
    });
    return changed ? [{ ...item, changes }, true] : [item, false];
  }
  if (item?.type === "dynamicToolCall" && Array.isArray(item.contentItems)) {
    let changed = false;
    const contentItems = item.contentItems.map((content) => {
      const original =
        content.type === "inputText"
          ? content.text
          : content.type === "inputImage"
            ? content.imageUrl
            : content.audioUrl;
      const key =
        content.type === "inputText"
          ? "text"
          : content.type === "inputImage"
            ? "imageUrl"
            : "audioUrl";
      const text = truncateText(original, limit);
      if (text === original) return content;
      changed = true;
      return { ...content, [key]: text };
    });
    const [args, argsChanged] = compactJsonStrings(item.arguments, limit);
    changed ||= argsChanged;
    return changed
      ? [
          { ...item, contentItems, arguments: args as typeof item.arguments },
          true,
        ]
      : [item, false];
  }
  if (item?.type === "mcpToolCall") {
    const [args, argsChanged] = compactJsonStrings(item.arguments, limit);
    const [result, resultChanged] = compactJsonStrings(item.result, limit);
    return argsChanged || resultChanged
      ? [
          {
            ...item,
            arguments: args as typeof item.arguments,
            result: result as typeof item.result,
          },
          true,
        ]
      : [item, false];
  }
  return [item, false];
};

const compactEvent = (
  event: ServerNotification,
  limit: number,
): [ServerNotification, boolean] => {
  if (
    (event.method === "item/started" || event.method === "item/completed") &&
    "item" in event.params
  ) {
    const [item, changed] = compactItem(event.params.item, limit);
    return changed
      ? [
          { ...event, params: { ...event.params, item } } as ServerNotification,
          true,
        ]
      : [event, false];
  }
  if (event.method === "turn/completed") {
    let changed = false;
    const items = event.params.turn.items.map((item) => {
      const [next, compacted] = compactItem(item, limit);
      changed ||= compacted;
      return next;
    });
    return changed
      ? [
          {
            ...event,
            params: { ...event.params, turn: { ...event.params.turn, items } },
          } as ServerNotification,
          true,
        ]
      : [event, false];
  }
  if (event.method === "item/fileChange/patchUpdated") {
    let changed = false;
    const changes = event.params.changes.map((change) => {
      const [next, compacted] = compactDiffChange(change, limit);
      changed ||= compacted;
      return next;
    });
    return changed
      ? [
          {
            ...event,
            params: { ...event.params, changes },
          } as ServerNotification,
          true,
        ]
      : [event, false];
  }
  if (
    event.method === "item/agentMessage/delta" ||
    event.method === "item/plan/delta" ||
    event.method === "item/reasoning/summaryTextDelta" ||
    event.method === "item/reasoning/textDelta"
  ) {
    const delta = truncateDisplayText(
      event.params.delta,
      DEFAULT_STREAM_TEXT_LIMIT,
    );
    return delta === event.params.delta
      ? [event, false]
      : [
          {
            ...event,
            params: { ...event.params, delta },
          } as ServerNotification,
          true,
        ];
  }
  if (event.method === "turn/diff/updated") {
    const diff = truncateDisplayText(
      event.params.diff,
      DEFAULT_STREAM_TEXT_LIMIT,
    );
    return diff === event.params.diff
      ? [event, false]
      : [
          { ...event, params: { ...event.params, diff } } as ServerNotification,
          true,
        ];
  }
  return [event, false];
};

export function compactCodexEventPayload(
  event: ServerNotification,
): ServerNotification {
  return compactEvent(event, DEFAULT_TOOL_TEXT_LIMIT)[0];
}

const isHiddenTranscriptEvent = (event: ServerNotification): boolean =>
  HIDDEN_TRANSCRIPT_METHODS.has(event.method) ||
  ((event.method === "item/started" || event.method === "item/completed") &&
    event.params.item.type === "sleep");

function getTurnId(event: ServerNotification): string | null {
  const params = event.params as { turnId?: unknown; turn?: { id?: unknown } };
  if (typeof params.turnId === "string") return params.turnId;
  if (typeof params.turn?.id === "string") return params.turn.id;
  return null;
}

const getItem = (event: ServerNotification): ThreadItem | null =>
  event.method === "item/started" || event.method === "item/completed"
    ? event.params.item
    : null;

const getItemId = (event: ServerNotification): string | null => {
  const item = getItem(event);
  if (item) return item.id;
  const params = event.params as {
    itemId?: unknown;
    reviewId?: unknown;
    targetItemId?: unknown;
  };
  if (typeof params.itemId === "string") return params.itemId;
  if (typeof params.targetItemId === "string") return params.targetItemId;
  return typeof params.reviewId === "string" ? params.reviewId : null;
};

const itemInProgress = (item: ThreadItem | null): boolean => {
  if (!item || !("status" in item)) return false;
  return typeof item.status === "string" && !terminalStatuses.has(item.status);
};

const eventSizes = (events: ServerNotification[]): number[] =>
  events.map((event) => estimateTranscriptBytes(event));

const indexesSize = (indexes: number[], sizes: number[]): number =>
  indexes.reduce((total, index) => total + sizes[index], 0);

function trimActiveTurnGroups(
  events: ServerNotification[],
  activeTurnIds: ReadonlySet<string>,
  keepGroups: number,
  targetBytes: number,
  targetEvents: number,
): { events: ServerNotification[]; trimmed: number; turnIds: string[] } {
  const groups = new Map<string, ItemGroup>();
  events.forEach((event, index) => {
    const turnId = getTurnId(event);
    const itemId = getItemId(event);
    if (!turnId || !itemId || !activeTurnIds.has(turnId)) return;
    const key = `${turnId}:${itemId}`;
    const group = groups.get(key) ?? {
      turnId,
      itemId,
      indexes: [],
      keep: false,
      assistant: false,
      started: false,
      completed: false,
      inProgress: false,
    };
    group.indexes.push(index);
    const item = getItem(event);
    group.started ||= event.method === "item/started";
    group.completed ||= event.method === "item/completed";
    if (item && "status" in item) group.inProgress = itemInProgress(item);
    group.keep ||=
      item?.type === "userMessage" ||
      item?.type === "collabAgentToolCall" ||
      item?.type === "subAgentActivity";
    group.assistant ||=
      item?.type === "agentMessage" ||
      event.method === "item/agentMessage/delta";
    groups.set(key, group);
  });
  const byTurn = new Map<string, ItemGroup[]>();
  for (const group of groups.values()) {
    const list = byTurn.get(group.turnId) ?? [];
    list.push(group);
    byTurn.set(group.turnId, list);
  }
  const remove = new Set<number>();
  const truncatedTurnIds = new Set<string>();
  const sizes = eventSizes(events);
  let retainedBytes = estimateTranscriptBytes(events);
  let retainedEvents = events.length;
  const removeGroup = (group: ItemGroup) => {
    if (group.indexes.every((index) => remove.has(index))) return;
    group.indexes.forEach((index) => remove.add(index));
    retainedBytes -= indexesSize(group.indexes, sizes);
    retainedEvents -= group.indexes.length;
    truncatedTurnIds.add(group.turnId);
  };
  for (const [turnId, list] of byTurn) {
    const newestAssistant = [...list]
      .reverse()
      .find((group) => group.assistant);
    const protectedGroups = new Set(
      list.filter(
        (group) =>
          group.keep ||
          group === newestAssistant ||
          group.inProgress ||
          (group.started && !group.completed),
      ),
    );
    const trimmable = list.filter((group) => !protectedGroups.has(group));
    for (const group of trimmable.slice(
      0,
      Math.max(0, trimmable.length - keepGroups),
    )) {
      removeGroup(group);
    }
    for (const group of trimmable.slice(
      Math.max(0, trimmable.length - keepGroups),
    )) {
      if (retainedBytes <= targetBytes && retainedEvents <= targetEvents) break;
      removeGroup(group);
    }
  }
  return {
    events: remove.size
      ? events.filter((_, index) => !remove.has(index))
      : events,
    trimmed: remove.size,
    turnIds: [...truncatedTurnIds],
  };
}

const budgetResult = (
  events: ServerNotification[],
  inputCount: number,
  compactedPayloadCount: number,
  evicted: boolean,
  hiddenEventCount: number,
  sameTurnTrimmedEventCount: number,
  truncatedTurnIds: string[],
  estimatedBytes: number,
): CodexTranscriptBudgetResult => ({
  events,
  trimmed:
    evicted ||
    compactedPayloadCount > 0 ||
    hiddenEventCount > 0 ||
    sameTurnTrimmedEventCount > 0,
  evicted,
  trimmedEventCount: Math.max(0, inputCount - events.length),
  compactedPayloadCount,
  hiddenEventCount,
  sameTurnTrimmedEventCount,
  truncatedTurnIds,
  oldestTurnId: events.map(getTurnId).find((id): id is string => Boolean(id)),
  estimatedBytes,
});

export function compactCodexTranscript(
  input: ServerNotification[],
  options: CodexTranscriptBudgetOptions,
): CodexTranscriptBudgetResult {
  const toolTextLimit = options.toolTextLimit ?? DEFAULT_TOOL_TEXT_LIMIT;
  let compactedPayloadCount = 0;
  let hiddenEventCount = 0;
  const visible = input.filter((event) => {
    const keep = !isHiddenTranscriptEvent(event);
    if (!keep) hiddenEventCount += 1;
    return keep;
  });
  const compacted = visible.map((event) => {
    const [next, changed] = compactEvent(event, toolTextLimit);
    if (changed) compactedPayloadCount += 1;
    return next;
  });
  const maxBytes = Math.max(0, options.maxBytes);
  const maxEvents = Math.max(0, options.maxEvents);
  const targetBytes = Math.min(options.targetBytes ?? maxBytes, maxBytes);
  const targetEvents = Math.min(options.targetEvents ?? maxEvents, maxEvents);
  let events = compacted;
  let bytes = estimateTranscriptBytes(events);
  if (bytes <= maxBytes && events.length <= maxEvents) {
    return budgetResult(
      compactedPayloadCount || hiddenEventCount ? events : input,
      input.length,
      compactedPayloadCount,
      false,
      hiddenEventCount,
      0,
      [],
      bytes,
    );
  }

  const liveTurnId =
    options.activeTurnId ??
    (events.length ? getTurnId(events[events.length - 1]) : null);
  const protectedIds = new Set(options.protectedTurnIds ?? []);
  if (liveTurnId) protectedIds.add(liveTurnId);
  const groups = new Map<string, number[]>();
  const sizes = eventSizes(events);
  events.forEach((event, index) => {
    const turnId = getTurnId(event);
    if (!turnId || protectedIds.has(turnId)) return;
    const indexes = groups.get(turnId);
    if (indexes) indexes.push(index);
    else groups.set(turnId, [index]);
  });

  const remove = new Set<number>();
  let retainedBytes = bytes;
  let retainedEvents = events.length;
  for (const indexes of groups.values()) {
    for (const index of indexes) {
      if (remove.has(index)) continue;
      remove.add(index);
      retainedBytes -= sizes[index];
      retainedEvents -= 1;
    }
    if (retainedBytes <= targetBytes && retainedEvents <= targetEvents) {
      events = events.filter((_, index) => !remove.has(index));
      bytes = estimateTranscriptBytes(events);
      return budgetResult(
        events,
        input.length,
        compactedPayloadCount,
        true,
        hiddenEventCount,
        0,
        [],
        bytes,
      );
    }
  }

  if (remove.size) events = events.filter((_, index) => !remove.has(index));
  const sameTurn = trimActiveTurnGroups(
    events,
    liveTurnId ? new Set([liveTurnId]) : new Set(),
    options.maxActiveToolGroups ?? DEFAULT_ACTIVE_TOOL_GROUPS,
    targetBytes,
    targetEvents,
  );
  events = sameTurn.events;
  bytes = estimateTranscriptBytes(events);
  return budgetResult(
    events,
    input.length,
    compactedPayloadCount,
    remove.size > 0,
    hiddenEventCount,
    sameTurn.trimmed,
    sameTurn.turnIds,
    bytes,
  );
}
