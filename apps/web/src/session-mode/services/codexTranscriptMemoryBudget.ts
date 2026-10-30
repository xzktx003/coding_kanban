import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2/ThreadItem";
import type { UserInput } from "@session/bindings/v2/UserInput";
import { projectCodexChatValue } from "@agent-orchestrator/shared/codex-chat-projection";
import { withoutToolTranscriptEvent } from "./codexTranscriptVisibility";

const estimateCache = new WeakMap<object, number>();
const OBJECT_OVERHEAD = 32;
const ARRAY_OVERHEAD = 24;
const TRUNCATION_MARKER = "\n...[truncated ";
const DISPLAY_PREVIEW_MARKER = "\n\n...[中间内容因会话内存限制已省略]...\n\n";
const DEFAULT_TOOL_TEXT_LIMIT = 64 * 1024;
const DEFAULT_STREAM_TEXT_LIMIT = 256 * 1024;
export const CODEX_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
export const CODEX_TRANSCRIPT_MAX_EVENTS = 3000;
export const STREAMING_TEXT_LIMIT = DEFAULT_STREAM_TEXT_LIMIT;
export const STREAMING_TEXT_PREVIEW_MARKER = DISPLAY_PREVIEW_MARKER;
export const STREAMING_TEXT_SEGMENT_CHARS = 8 * 1024;
const STREAMING_PREVIEW_CONTENT_LIMIT =
  STREAMING_TEXT_LIMIT - STREAMING_TEXT_PREVIEW_MARKER.length;
const STREAMING_PREVIEW_HEAD_LIMIT =
  Math.floor(
    (STREAMING_PREVIEW_CONTENT_LIMIT * 0.75) / STREAMING_TEXT_SEGMENT_CHARS,
  ) * STREAMING_TEXT_SEGMENT_CHARS;
const STREAMING_PREVIEW_TAIL_LIMIT =
  Math.floor(
    (STREAMING_PREVIEW_CONTENT_LIMIT - STREAMING_PREVIEW_HEAD_LIMIT) /
      STREAMING_TEXT_SEGMENT_CHARS,
  ) * STREAMING_TEXT_SEGMENT_CHARS;
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

export interface StreamingTextPreview {
  head: string[];
  tail: string[];
  tailCurrent: string;
}

// V8 slices/concatenations can retain the entire source string. Copy only the
// bounded display text; split/join preserves UTF-16 (including lone surrogates).
// Do not replace this with slice(), substring(), or a prefix-and-slice trick.
export function copyTranscriptText(text: string): string {
  return text.split("").join("");
}

function splitStreamingText(text: string) {
  const segments: string[] = [];
  let offset = 0;
  while (text.length - offset >= STREAMING_TEXT_SEGMENT_CHARS) {
    segments.push(
      copyTranscriptText(
        text.slice(offset, offset + STREAMING_TEXT_SEGMENT_CHARS),
      ),
    );
    offset += STREAMING_TEXT_SEGMENT_CHARS;
  }
  return { segments, current: copyTranscriptText(text.slice(offset)) };
}

export function createStreamingTextPreview(text: string): StreamingTextPreview {
  const { segments: head } = splitStreamingText(
    text.slice(0, STREAMING_PREVIEW_HEAD_LIMIT),
  );
  const tailText = text.slice(-STREAMING_PREVIEW_TAIL_LIMIT);
  const { segments: tail, current: tailCurrent } = splitStreamingText(tailText);
  return {
    head,
    tail,
    tailCurrent,
  };
}

export function appendStreamingTextPreview(
  preview: StreamingTextPreview,
  delta: string,
): StreamingTextPreview {
  const deltaSuffix =
    delta.length > STREAMING_PREVIEW_TAIL_LIMIT + STREAMING_TEXT_SEGMENT_CHARS
      ? delta.slice(
          -(STREAMING_PREVIEW_TAIL_LIMIT + STREAMING_TEXT_SEGMENT_CHARS),
        )
      : delta;
  const combined = `${preview.tailCurrent}${deltaSuffix}`;
  const completeLength =
    Math.floor(combined.length / STREAMING_TEXT_SEGMENT_CHARS) *
    STREAMING_TEXT_SEGMENT_CHARS;
  const tail = [...preview.tail];
  for (
    let offset = 0;
    offset < completeLength;
    offset += STREAMING_TEXT_SEGMENT_CHARS
  )
    tail.push(
      copyTranscriptText(
        combined.slice(offset, offset + STREAMING_TEXT_SEGMENT_CHARS),
      ),
    );
  let tailCurrent = copyTranscriptText(combined.slice(completeLength));
  let excess =
    tail.reduce((length, segment) => length + segment.length, 0) +
    tailCurrent.length -
    STREAMING_PREVIEW_TAIL_LIMIT;
  while (excess > 0 && tail.length) {
    if (tail[0].length <= excess) {
      excess -= tail[0].length;
      tail.shift();
    } else {
      tail[0] = copyTranscriptText(tail[0].slice(excess));
      excess = 0;
    }
  }
  if (excess > 0) tailCurrent = copyTranscriptText(tailCurrent.slice(excess));
  return {
    head: preview.head,
    tail,
    tailCurrent,
  };
}

export function materializeStreamingTextPreview(
  preview: StreamingTextPreview,
): string {
  return `${preview.head.join("")}${STREAMING_TEXT_PREVIEW_MARKER}${preview.tail.join("")}${preview.tailCurrent}`;
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
  return copyTranscriptText(
    `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`,
  );
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
  return copyTranscriptText(
    `${head.slice(0, headLimit)}${DISPLAY_PREVIEW_MARKER}${tail.slice(-tailLimit)}`,
  );
};

// User text has native UTF-8 element offsets. A display preview must not leave
// elements pointing into the omitted middle, or reinterpret a byte as UTF-16.
function utf8Length(text: string, end = text.length): number {
  let bytes = 0;
  for (let index = 0; index < end; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < end &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

function compactUserText(
  input: Extract<UserInput, { type: "text" }>,
  limit: number,
) {
  if (input.text.length <= limit) return input;
  const available = Math.max(0, limit - DISPLAY_PREVIEW_MARKER.length);
  let headEnd = Math.floor(available * 0.75);
  let tailStart = input.text.length - (available - headEnd);
  const splitsPair = (index: number) =>
    index > 0 &&
    index < input.text.length &&
    input.text.charCodeAt(index - 1) >= 0xd800 &&
    input.text.charCodeAt(index - 1) <= 0xdbff &&
    input.text.charCodeAt(index) >= 0xdc00 &&
    input.text.charCodeAt(index) <= 0xdfff;
  if (splitsPair(headEnd)) headEnd--;
  if (splitsPair(tailStart)) tailStart++;
  if (limit <= DISPLAY_PREVIEW_MARKER.length)
    return {
      ...input,
      text: copyTranscriptText(DISPLAY_PREVIEW_MARKER.slice(0, limit)),
      text_elements: [],
    };
  const headBytes = utf8Length(input.text, headEnd);
  const tailStartBytes = utf8Length(input.text, tailStart);
  const totalBytes = tailStartBytes + utf8Length(input.text.slice(tailStart));
  const shiftedTailStart = headBytes + utf8Length(DISPLAY_PREVIEW_MARKER);
  const text_elements = (input.text_elements ?? []).flatMap((element) => {
    const { start, end } = element.byteRange;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > totalBytes
    )
      return [];
    if (end <= headBytes) return [element];
    if (start < tailStartBytes) return [];
    return [
      {
        ...element,
        byteRange: {
          start: shiftedTailStart + start - tailStartBytes,
          end: shiftedTailStart + end - tailStartBytes,
        },
      },
    ];
  });
  return {
    ...input,
    text: copyTranscriptText(
      `${input.text.slice(0, headEnd)}${DISPLAY_PREVIEW_MARKER}${input.text.slice(tailStart)}`,
    ),
    text_elements,
  };
}

function compactUserContent(content: UserInput[], limit: number): UserInput[] {
  const texts = content.filter((input) => input.type === "text");
  if (texts.reduce((sum, input) => sum + input.text.length, 0) <= limit)
    return content;
  let remaining = limit;
  let count = texts.length;
  return content.map((input) => {
    if (input.type !== "text") return input;
    const next = compactUserText(input, Math.floor(remaining / count));
    remaining -= next.text.length;
    count--;
    return next;
  });
}

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
  displayTextLimit = DEFAULT_STREAM_TEXT_LIMIT,
): [ThreadItem, boolean] => {
  if (item?.type === "userMessage") {
    const content = compactUserContent(item.content, displayTextLimit);
    return content === item.content
      ? [item, false]
      : [{ ...item, content }, true];
  }
  if (item?.type === "agentMessage" || item?.type === "plan") {
    const text = truncateDisplayText(item.text, displayTextLimit);
    return text === item.text ? [item, false] : [{ ...item, text }, true];
  }
  if (item?.type === "reasoning") {
    let changed = false;
    const compactParts = (parts: string[]) =>
      parts.map((part) => {
        const text = truncateDisplayText(part, displayTextLimit);
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

const compactVisibleEvent = (
  event: ServerNotification,
  limit: number,
  displayTextLimit = DEFAULT_STREAM_TEXT_LIMIT,
): [ServerNotification, boolean] => {
  if (
    (event.method === "item/started" || event.method === "item/completed") &&
    "item" in event.params
  ) {
    const [item, changed] = compactItem(
      event.params.item,
      limit,
      displayTextLimit,
    );
    return changed
      ? [
          { ...event, params: { ...event.params, item } } as ServerNotification,
          true,
        ]
      : [event, false];
  }
  if (event.method === "turn/completed" || event.method === "turn/started") {
    let changed = false;
    const items = (event.params.turn.items ?? []).map((item) => {
      const [next, compacted] = compactItem(item, limit, displayTextLimit);
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
    const delta = truncateDisplayText(event.params.delta, displayTextLimit);
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

const compactEvent = (
  event: ServerNotification,
  limit: number,
  displayTextLimit = DEFAULT_STREAM_TEXT_LIMIT,
): [ServerNotification, boolean] => {
  const projected = withoutToolTranscriptEvent(event);
  if (projected === null) {
    // Direct callers still receive a typed event, but never its private body.
    const cursor = projectCodexChatValue(event) as ServerNotification;
    if (
      cursor.method === "item/started" ||
      cursor.method === "item/completed" ||
      cursor.method === "turn/completed"
    ) {
      const [next, changed] = compactVisibleEvent(
        cursor,
        limit,
        displayTextLimit,
      );
      return [next, changed || cursor !== event];
    }
    return [cursor, cursor !== event];
  }
  return compactProjectedEvent(event, projected, limit, displayTextLimit);
};

const compactProjectedEvent = (
  event: ServerNotification,
  projected: ServerNotification,
  limit: number,
  displayTextLimit = DEFAULT_STREAM_TEXT_LIMIT,
): [ServerNotification, boolean] => {
  const [next, changed] = compactVisibleEvent(
    projected,
    limit,
    displayTextLimit,
  );
  return [next, changed || projected !== event];
};

export function compactCodexEventPayload(
  event: ServerNotification,
): ServerNotification {
  return compactEvent(event, DEFAULT_TOOL_TEXT_LIMIT)[0];
}

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
  const compactedPayloads = new WeakSet<object>();
  let hiddenEventCount = 0;
  const compacted: ServerNotification[] = [];
  for (const event of input) {
    if (
      HIDDEN_TRANSCRIPT_METHODS.has(event.method) ||
      ((event.method === "item/started" || event.method === "item/completed") &&
        event.params.item.type === "sleep")
    ) {
      hiddenEventCount += 1;
      continue;
    }
    const projected = withoutToolTranscriptEvent(event);
    if (projected === null) {
      hiddenEventCount += 1;
      continue;
    }
    const [next, changed] = compactProjectedEvent(
      event,
      projected,
      toolTextLimit,
    );
    if (changed) {
      compactedPayloadCount += 1;
      compactedPayloads.add(next);
    }
    compacted.push(next);
  }
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
  // If bytes already satisfy the low watermark, whole-turn removal for the
  // event watermark cannot increase the cached retained-size estimate. Keep
  // the original byte accounting whenever bytes are still over target.
  const countOnlyTrim = bytes <= targetBytes;
  const groups = new Map<
    string,
    { indexes: number[]; estimatedBytes: number }
  >();
  events.forEach((event, index) => {
    const turnId = getTurnId(event);
    if (!turnId || protectedIds.has(turnId)) return;
    const group = groups.get(turnId) ?? { indexes: [], estimatedBytes: 0 };
    group.indexes.push(index);
    if (!countOnlyTrim) group.estimatedBytes += estimateTranscriptBytes(event);
    groups.set(turnId, group);
  });

  const remove = new Set<number>();
  let retainedBytes = bytes;
  let retainedEvents = events.length;
  for (const group of groups.values()) {
    for (const index of group.indexes) {
      if (remove.has(index)) continue;
      remove.add(index);
      retainedEvents -= 1;
    }
    if (!countOnlyTrim) retainedBytes -= group.estimatedBytes;
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
  // Protected users, native identities and the current reading window must not
  // become a bypass for display bodies. Reduce only their text previews; never
  // remove approvals, item/turn identities or alter image/attachment references.
  // Metadata alone can still exceed the budget. Callers must reject admission
  // when estimatedBytes remains over maxBytes rather than publish then reclaim.
  let displayTextLimit = DEFAULT_STREAM_TEXT_LIMIT;
  while (bytes > maxBytes && displayTextLimit > 256) {
    displayTextLimit = Math.max(256, Math.floor(displayTextLimit / 2));
    events = events.map((event) => {
      const [next, changed] = compactVisibleEvent(
        event,
        toolTextLimit,
        displayTextLimit,
      );
      if (changed) {
        if (!compactedPayloads.has(event)) compactedPayloadCount++;
        compactedPayloads.add(next);
      }
      return next;
    });
    bytes = estimateTranscriptBytes(events);
  }
  // An unshrinkable protected payload may remain over budget. Returning only a
  // fresh wrapper would falsely announce a body change and make the governor
  // schedule itself forever, although every native event is still identical.
  if (
    events.length === input.length &&
    events.every((event, index) => event === input[index])
  )
    events = input;
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
