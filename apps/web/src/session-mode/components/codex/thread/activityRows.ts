import type { ServerNotification } from "@session/bindings";
import type {
  CommandAction,
  ThreadItem,
  TurnStatus,
} from "@session/bindings/v2";
import type { CommandActionSource } from "./deriveRenderItems";
import type { ThreadRow } from "./threadRows";
import type { ItemGuardianApprovalReviewStartedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewStartedNotification";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import {
  nativeAutomaticReviewMetadata,
  nativeMcpCompletedSummaryClassification,
  nativeToolActivityMetadata,
} from "../presentation/nativeToolSemantics";
import { nativeDynamicToolCompletedSummaryKey } from "../presentation/nativeDynamicToolSemantics";

export type CommandEntry = {
  kind: "command";
  key: string;
  row: ThreadRow;
  action: CommandAction;
  source: CommandActionSource;
  threadId: string;
  turnId: string;
  pending: boolean;
  bodyVisible: boolean;
};
export type EventEntry = {
  kind: "event";
  key: string;
  row: ThreadRow;
  item: ThreadItem;
  threadId: string;
  turnId: string;
  pending: boolean;
  bodyVisible: boolean;
};
export type AutoReviewEntry = {
  kind: "review";
  key: string;
  row: ThreadRow;
  value:
    | ItemGuardianApprovalReviewStartedNotification
    | ItemGuardianApprovalReviewCompletedNotification;
  threadId: string;
  turnId: string;
  pending: boolean;
  bodyVisible: boolean;
};
export type ActivityEntry = CommandEntry | EventEntry | AutoReviewEntry;
export type ActivityState =
  | { kind: "summary" }
  | { kind: "thinking" }
  | { kind: "active"; entry: ActivityEntry };
export type ActivitySummaryPart =
  | {
      kind: "tools" | "files" | "exploration" | "commands" | "web";
      count: number;
    }
  | {
      kind: "mcpSources";
      sources: {
        key: string;
        name: string;
        preferred: boolean;
        count: number;
      }[];
    }
  | {
      kind: "mcpNative";
      key: string;
      item: Extract<ThreadItem, { type: "mcpToolCall" }>;
    }
  | {
      kind: "dynamic";
      tool: string;
      count: number;
      item: Extract<ThreadItem, { type: "dynamicToolCall" }>;
    };
export type ActivityGroup = {
  threadId: string;
  turnId: string;
  entries: ActivityEntry[];
  state: ActivityState;
  canExpand: boolean;
  closed: boolean;
  parts: ActivitySummaryPart[];
  /** Small presentation revision; no full output/result serialization on each update. */
  revision: string;
};
const itemRevisions = new WeakMap<object, number>();
let nextItemRevision = 0;
function activityRevision(
  entries: ActivityEntry[],
  state: ActivityState,
): string {
  let hash = 2166136261;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index++)
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  };
  for (const entry of entries) {
    if (entry.kind === "command") {
      const source = entry.source,
        output = source.aggregatedOutput ?? "";
      add(
        `${source.commandItemId}:${source.status}:${source.exitCode}:${source.termination}:${output.length}:${output.slice(-64)}`,
      );
    } else {
      const value = entry.kind === "review" ? entry.value : entry.item;
      let revision = itemRevisions.get(value);
      if (revision === undefined) {
        revision = ++nextItemRevision;
        itemRevisions.set(value, revision);
      }
      add(`${entry.key}:${revision}:${entry.row.context?.renderTermination}`);
    }
  }
  return `${state.kind}:${entries.length}:${hash >>> 0}`;
}
export type ActivityDisplayRow = ThreadRow & {
  activity?: ActivityGroup;
  /** Share the same child state when native Je unwraps a completed activity. */
  activityEntry?: ActivityEntry;
};
export type ActivityRuntime = {
  running: boolean;
  turnId: string | null;
  threadId: string;
  terminal?: { turnId: string; status: TurnStatus };
};
const turnKey = (owner: string, turn: string) => JSON.stringify([owner, turn]);
const groupable = new Set([
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
]);
const isExploration = (entry: ActivityEntry) =>
  entry.kind === "command" && entry.action.type !== "unknown";

function entriesFor(row: ThreadRow): ActivityEntry[] | null {
  if (row.item.kind === "cmdGroup") {
    const group = row.item;
    return group.actions
      .map((action, index): CommandEntry | null => {
        const source = group.actionSources[index];
        if (!source) return null;
        const threadId = source.threadId ?? "",
          turnId = source.turnId ?? "";
        const key = JSON.stringify([
          threadId,
          turnId,
          source.commandItemId,
          action,
          index,
        ]);
        const pending = source.status === "inProgress" && !source.termination;
        return {
          kind: "command" as const,
          key,
          threadId,
          turnId,
          action,
          source,
          pending,
          bodyVisible:
            action.type === "unknown" ||
            source.status === "completed" ||
            !!source.termination ||
            source.status === "failed" ||
            source.status === "declined",
          row: {
            ...row,
            item: { ...group, key, actions: [action], actionSources: [source] },
          },
        };
      })
      .filter((entry): entry is CommandEntry => entry !== null);
  }
  const event = row.item.event;
  const review = nativeAutomaticReviewMetadata(event);
  if (review)
    return review.grouping === "hidden"
      ? []
      : [
          {
            kind: "review",
            key: `review-${review.key}`,
            row: { ...row, key: `review-${review.key}` },
            value: review.value,
            threadId: review.threadId,
            turnId: review.turnId,
            pending: review.pending && !row.context?.renderTermination,
            bodyVisible: true,
          },
        ];
  if (event.method !== "item/started" && event.method !== "item/completed")
    return null;
  const item = event.params.item;
  if (
    nativeToolActivityMetadata(item).grouping === "hidden" &&
    groupable.has(item.type)
  )
    return [];
  if (!groupable.has(item.type)) return null;
  const status = "status" in item ? item.status : undefined;
  const pending =
    !row.context?.renderTermination &&
    (status ? status === "inProgress" : event.method === "item/started");
  return [
    {
      kind: "event",
      key: row.key,
      row,
      item,
      threadId: event.params.threadId,
      turnId: event.params.turnId,
      pending,
      bodyVisible:
        !nativeToolActivityMetadata(item).summaryOnly &&
        (item.type !== "fileChange" || item.changes.length > 0),
    },
  ];
}

export function activitySummary(
  entries: ActivityEntry[],
): ActivitySummaryPart[] {
  let tools = 0,
    web = 0;
  const files = new Set<string>(),
    commands = new Set<string>(),
    mcpSources = new Map<
      string,
      { key: string; name: string; preferred: boolean; count: number }
    >(),
    nativeParts = new Map<
      string,
      Extract<ActivitySummaryPart, { kind: "dynamic" | "mcpNative" }>
    >();
  let exploration = false;
  for (const entry of entries) {
    if (entry.kind === "command") {
      if (entry.action.type !== "unknown")
        exploration ||= entry.source.status === "completed";
      else
        commands.add(
          JSON.stringify([
            entry.threadId,
            entry.turnId,
            entry.source.commandItemId,
          ]),
        );
    } else if (entry.kind === "review") continue;
    else if (entry.item.type === "fileChange") {
      // Applying a proposed patch is not proof that any file has changed yet.
      if (entry.item.status === "completed")
        for (const change of entry.item.changes) files.add(change.path);
    } else if (entry.item.type === "mcpToolCall") {
      const classification = nativeMcpCompletedSummaryClassification(
        entry.item,
      );
      if (classification.kind === "source") {
        const { source } = classification,
          existing = mcpSources.get(source.key);
        mcpSources.set(
          source.key,
          existing
            ? {
                ...existing,
                ...source,
                count: existing.count + 1,
                preferred: existing.preferred || source.preferred,
              }
            : { ...source, count: 1 },
        );
      } else if (classification.kind === "native") {
        if (!nativeParts.has(classification.key))
          nativeParts.set(classification.key, {
            kind: "mcpNative",
            key: classification.key,
            item: entry.item,
          });
      } else if (classification.kind === "command")
        commands.add(
          JSON.stringify([
            entry.threadId,
            entry.turnId,
            "mcpCommand",
            entry.item.id,
          ]),
        );
      else tools++;
    } else if (entry.item.type === "webSearch") web++;
    else if (entry.item.type === "dynamicToolCall") {
      const key = nativeDynamicToolCompletedSummaryKey(entry.item);
      const existing = nativeParts.get(key);
      if (!existing || existing.kind === "dynamic")
        nativeParts.set(
          key,
          existing
            ? { ...existing, count: existing.count + 1 }
            : {
                kind: "dynamic",
                tool: entry.item.tool,
                count: 1,
                item: entry.item,
              },
        );
    }
  }
  const parts: ActivitySummaryPart[] = [];
  if (mcpSources.size)
    parts.push({
      kind: "mcpSources",
      sources: [...mcpSources.values()].sort(
        (a, b) => Number(b.preferred) - Number(a.preferred),
      ),
    });
  if (tools) parts.push({ kind: "tools", count: tools });
  if (files.size) parts.push({ kind: "files", count: files.size });
  if (exploration) parts.push({ kind: "exploration", count: 1 });
  if (commands.size) parts.push({ kind: "commands", count: commands.size });
  if (web) parts.push({ kind: "web", count: web });
  // Native Me keeps one ordered set for specialized MCP and dynamic labels.
  for (const part of nativeParts.values()) parts.push(part);
  return parts;
}

/** Native P/Je/Ye: contiguous mixed activities, stable first identity, and active/thinking/summary. */
export function groupThreadActivities(
  rows: ThreadRow[],
  events: ServerNotification[],
  runtime?: ActivityRuntime,
): ActivityDisplayRow[] {
  rows = projectNativeActivityRows(rows);
  const turns = new Map<string, TurnStatus>();
  for (const event of events) {
    if (event.method === "turn/started") {
      const key = turnKey(event.params.threadId, event.params.turn.id);
      // Replayed starts cannot revive a verified terminal turn.
      if (!turns.has(key)) turns.set(key, "inProgress");
    } else if (event.method === "turn/completed")
      turns.set(
        turnKey(event.params.threadId, event.params.turn.id),
        event.params.turn.status,
      );
    else if (
      event.method === "error" &&
      !event.params.willRetry &&
      event.params.turnId
    )
      turns.set(turnKey(event.params.threadId, event.params.turnId), "failed");
  }
  if (runtime?.terminal)
    turns.set(
      turnKey(runtime.threadId, runtime.terminal.turnId),
      runtime.terminal.status,
    );
  const output: ActivityDisplayRow[] = [];
  let buffer: ActivityEntry[] = [],
    firstKey = "";
  const flush = (closed: boolean) => {
    if (!buffer.length) return;
    let entries = buffer;
    const originalFirst = entries[0];
    buffer = [];
    const turn = turns.get(
      turnKey(originalFirst.threadId, originalFirst.turnId),
    );
    const terminal = !!turn && turn !== "inProgress";
    if (terminal)
      entries = entries.map((entry) => {
        if (!entry.pending) return entry;
        if (entry.kind === "command") {
          const source = { ...entry.source, termination: turn };
          return {
            ...entry,
            source,
            pending: false,
            bodyVisible: true,
            row: {
              ...entry.row,
              item:
                entry.row.item.kind === "cmdGroup"
                  ? { ...entry.row.item, actionSources: [source] }
                  : entry.row.item,
            },
          };
        }
        return {
          ...entry,
          pending: false,
          row: {
            ...entry.row,
            context: { ...entry.row.context, renderTermination: turn },
          },
        };
      });
    const first = entries[0];
    const live =
      !terminal &&
      (turn === "inProgress" ||
        entries.some((entry) => entry.pending) ||
        (runtime?.running &&
          runtime.threadId === first.threadId &&
          (!runtime.turnId || runtime.turnId === first.turnId)));
    let state: ActivityState = { kind: "summary" };
    if (!closed && live) {
      let pending: ActivityEntry | undefined;
      for (let index = entries.length - 1; index >= 0; index--)
        if (entries[index].pending) {
          pending = entries[index];
          break;
        }
      state =
        pending && pending.kind !== "review"
          ? { kind: "active", entry: pending }
          : { kind: "thinking" };
    }
    // Je unwraps a single finished activity, except a multi-file patch.
    const single =
      entries.length === 1 &&
      state.kind === "summary" &&
      !first.pending &&
      !(
        first.kind === "event" &&
        first.item.type === "fileChange" &&
        first.item.changes.length !== 1
      );
    if (single)
      output.push({ ...first.row, key: firstKey, activityEntry: first });
    else
      output.push({
        ...first.row,
        key: firstKey,
        activity: {
          threadId: first.threadId,
          turnId: first.turnId,
          entries,
          state,
          closed,
          canExpand: entries.some((entry) => entry.bodyVisible),
          parts: activitySummary(entries),
          revision: activityRevision(entries, state),
        },
      });
  };
  for (const row of rows) {
    const entries = entriesFor(row);
    if (entries?.length === 0) continue;
    if (!entries?.length) {
      flush(true);
      output.push(row);
      continue;
    }
    if (
      entries[0]?.kind === "review" &&
      entries[0].value.review.status !== "inProgress"
    ) {
      flush(true);
      output.push({ ...entries[0].row, activityEntry: entries[0] });
      continue;
    }
    if (
      entries[0]?.kind === "event" &&
      entries[0].item.type === "dynamicToolCall" &&
      nativeToolActivityMetadata(entries[0].item).grouping === "standalone"
    ) {
      flush(true);
      output.push({ ...entries[0].row, activityEntry: entries[0] });
      continue;
    }
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const first = buffer[0];
      if (
        first &&
        (first.threadId !== entry.threadId || first.turnId !== entry.turnId)
      )
        flush(true);
      if (!buffer.length)
        firstKey = index === 0 ? row.key : `${row.key}:${entry.key}`;
      buffer.push(entry);
    }
  }
  flush(false);
  return output;
}

/** Coalesce presentation records without changing the native log or verified statuses. */
function projectNativeActivityRows(rows: ThreadRow[]): ThreadRow[] {
  const anchors: ThreadRow[] = [];
  const reviews = new Map<string, number>();
  for (const row of rows) {
    const metadata =
      row.item.kind === "event"
        ? nativeAutomaticReviewMetadata(row.item.event)
        : null;
    if (!metadata) {
      anchors.push(row);
      continue;
    }
    const index = reviews.get(metadata.key);
    if (index === undefined) {
      reviews.set(metadata.key, anchors.length);
      anchors.push({ ...row, key: `review-${metadata.key}` });
      continue;
    }
    const previous = anchors[index];
    const old =
      previous.item.kind === "event"
        ? nativeAutomaticReviewMetadata(previous.item.event)
        : null;
    if (old && !old.pending && metadata.pending) continue;
    anchors[index] = { ...row, key: previous.key };
  }
  const output: ThreadRow[] = [];
  for (const row of anchors) {
    const e = row.item.kind === "event" ? row.item.event : null;
    const metadata = e ? nativeAutomaticReviewMetadata(e) : null;
    if (metadata?.grouping === "hidden") continue;
    if (
      !e ||
      (e.method !== "item/started" && e.method !== "item/completed") ||
      !["imageView", "imageGeneration"].includes(e.params.item.type)
    ) {
      output.push(row);
      continue;
    }
    const previous = output.at(-1),
      p = previous?.item.kind === "event" ? previous.item.event : null;
    if (
      !previous ||
      !p ||
      (p.method !== "item/started" && p.method !== "item/completed") ||
      p.params.threadId !== e.params.threadId ||
      p.params.turnId !== e.params.turnId ||
      p.params.item.type !== e.params.item.type
    ) {
      output.push(row);
      continue;
    }
    const original = p.params.item,
      following = e.params.item;
    let item: ThreadItem;
    if (original.type === "imageView" && following.type === "imageView") {
      const a = (original as typeof original & { imagePaths?: string[] })
          .imagePaths ?? [original.path],
        b = (following as typeof following & { imagePaths?: string[] })
          .imagePaths ?? [following.path];
      item = {
        ...original,
        imagePaths: [...a, ...b],
        imageCount: a.length + b.length,
      } as ThreadItem;
    } else if (
      original.type === "imageGeneration" &&
      following.type === "imageGeneration"
    ) {
      const a = (original as typeof original & { images?: (typeof original)[] })
          .images ?? [original],
        b = (following as typeof following & { images?: (typeof following)[] })
          .images ?? [following];
      item = { ...original, images: [...a, ...b] } as ThreadItem;
    } else {
      output.push(row);
      continue;
    }
    output[output.length - 1] = {
      ...previous,
      item: {
        ...previous.item,
        event: { ...p, params: { ...p.params, item } },
      } as typeof previous.item,
    };
  }
  return output;
}
