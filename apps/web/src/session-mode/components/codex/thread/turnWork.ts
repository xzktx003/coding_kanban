import type { ServerNotification } from "@session/bindings";
import type { TurnTiming } from "../stores/useCodexStore";
import type { ActivityDisplayRow } from "./activityRows";
import { readQuestions } from "@session/features/async-questions/model";

export interface TurnWork {
  key: string;
  threadId: string;
  turnId: string;
  running: boolean;
  startedAtMs: number | null;
  durationMs: number | null;
  processKeys: Set<string>;
  expanded: boolean;
}
export type TranscriptWorkRow = ActivityDisplayRow & { work?: TurnWork };

export function projectTurnWork(
  rows: ActivityDisplayRow[],
  events: ServerNotification[],
  timing: TurnTiming | undefined,
  opened: ReadonlySet<string>,
  ownerId?: string,
): TranscriptWorkRow[] {
  type Meta = {
    threadId: string;
    turnId: string;
    status: string;
    startedAtMs: number | null;
    durationMs: number | null;
  };
  const groups = new Map<string, Meta>();
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  for (const event of events) {
    if (event.method !== "turn/started" && event.method !== "turn/completed")
      continue;
    const { threadId, turn } = event.params;
    const key = turnWorkKey(threadId, turn.id),
      previous = groups.get(key);
    if (
      event.method === "turn/started" &&
      previous &&
      previous.status !== "inProgress"
    )
      continue;
    const startedAtMs = valid(turn.startedAt)
      ? turn.startedAt * 1000
      : (previous?.startedAtMs ?? null);
    const durationMs = valid(turn.durationMs)
      ? turn.durationMs
      : startedAtMs !== null &&
          valid(turn.completedAt) &&
          turn.completedAt * 1000 >= startedAtMs
        ? turn.completedAt * 1000 - startedAtMs
        : (previous?.durationMs ?? null);
    groups.set(key, {
      threadId,
      turnId: turn.id,
      status: event.method === "turn/started" ? "inProgress" : turn.status,
      startedAtMs,
      durationMs,
    });
  }
  if (timing && ownerId) {
    const key = turnWorkKey(ownerId, timing.turnId),
      previous = groups.get(key);
    groups.set(key, {
      threadId: ownerId,
      turnId: timing.turnId,
      status:
        previous && previous.status !== "inProgress"
          ? previous.status
          : timing.status,
      startedAtMs:
        previous?.startedAtMs ??
        (valid(timing.startedAtMs) ? timing.startedAtMs : null),
      durationMs:
        previous?.durationMs ??
        (valid(timing.durationMs) ? timing.durationMs : null),
    });
  }
  const owner = (row: ActivityDisplayRow) => {
    if (row.activity)
      return turnWorkKey(row.activity.threadId, row.activity.turnId);
    if (row.activityEntry)
      return turnWorkKey(row.activityEntry.threadId, row.activityEntry.turnId);
    if (row.item.kind === "cmdGroup") {
      const source = row.item.actionSources[0];
      return source?.threadId && source.turnId
        ? turnWorkKey(source.threadId, source.turnId)
        : null;
    }
    const event = row.item.event,
      params = event.params;
    if (!("threadId" in params) || !params.threadId) return null;
    const turnId =
      event.method === "turn/completed"
        ? event.params.turn.id
        : "turnId" in params
          ? params.turnId
          : null;
    return turnId ? turnWorkKey(params.threadId, turnId) : null;
  };
  const finalIds = new Map<string, Set<string>>();
  for (const event of events) {
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      event.params.item.type === "agentMessage" &&
      event.params.item.phase === "final_answer"
    ) {
      const key = turnWorkKey(event.params.threadId, event.params.turnId),
        ids = finalIds.get(key) ?? new Set<string>();
      ids.add(event.params.item.id);
      finalIds.set(key, ids);
    }
  }
  // Legacy histories do not always carry phase. Only a confirmed completed
  // turn permits its last unclassified assistant message to be the report.
  const legacyFinal = new Map<string, string>();
  for (const row of rows) {
    const key = owner(row);
    if (
      !key ||
      groups.get(key)?.status !== "completed" ||
      finalIds.has(key) ||
      row.item.kind !== "event"
    )
      continue;
    const event = row.item.event;
    if (
      event.method === "item/completed" &&
      event.params.item.type === "agentMessage" &&
      event.params.item.phase == null &&
      !readQuestions(event.params.item).length
    )
      legacyFinal.set(key, row.key);
  }
  const isProcess = (row: ActivityDisplayRow, key: string) => {
    if (legacyFinal.get(key) === row.key) return false;
    if (row.activity || row.activityEntry || row.item.kind === "cmdGroup")
      return true;
    const event = row.item.event;
    if (event.method === "item/agentMessage/delta")
      return !finalIds.get(key)?.has(event.params.itemId);
    if (
      event.method === "turn/plan/updated" ||
      event.method === "item/plan/delta" ||
      event.method === "item/commandExecution/terminalInteraction"
    )
      return true;
    if (event.method !== "item/started" && event.method !== "item/completed")
      return false;
    const item = event.params.item;
    if (item.type === "agentMessage")
      return (
        item.phase !== "final_answer" &&
        !finalIds.get(key)?.has(item.id) &&
        !readQuestions(item).length
      );
    return [
      "reasoning",
      "plan",
      "commandExecution",
      "hookPrompt",
      "collabAgentToolCall",
      "subAgentActivity",
      "fileChange",
      "mcpToolCall",
      "webSearch",
      "dynamicToolCall",
      "contextCompaction",
      "imageView",
      "imageGeneration",
    ].includes(item.type);
  };
  const processes = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = owner(row);
    if (!key || !groups.has(key) || !isProcess(row, key)) continue;
    const keys = processes.get(key) ?? new Set<string>();
    keys.add(row.key);
    processes.set(key, keys);
  }
  const works = new Map<string, TurnWork>();
  for (const [key, meta] of groups) {
    const processKeys = processes.get(key) ?? new Set<string>();
    const running = meta.status === "inProgress";
    const terminal = ["completed", "failed", "interrupted"].includes(
      meta.status,
    );
    if (!processKeys.size && !running && meta.durationMs === null) continue;
    works.set(key, {
      key,
      threadId: meta.threadId,
      turnId: meta.turnId,
      running,
      startedAtMs: meta.startedAtMs,
      durationMs: meta.durationMs,
      processKeys,
      expanded: running || !terminal || opened.has(key),
    });
  }
  const result: TranscriptWorkRow[] = [],
    emitted = new Set<string>();
  const header = (work: TurnWork, item: ActivityDisplayRow["item"]) => {
    result.push({ key: work.key, item, work });
    emitted.add(work.key);
  };
  for (const row of rows) {
    const key = owner(row),
      work = key ? works.get(key) : undefined;
    const user =
      row.item.kind === "event" &&
      row.item.event.method === "item/started" &&
      row.item.event.params.item.type === "userMessage";
    if (work && !emitted.has(work.key) && !user) header(work, row.item);
    if (!work || work.expanded || !work.processKeys.has(row.key))
      result.push(row);
    if (work && user && !emitted.has(work.key)) header(work, row.item);
  }
  for (const work of works.values()) {
    if (!work.running || emitted.has(work.key)) continue;
    const source = events.find(
      (event) =>
        event.method === "turn/started" &&
        event.params.threadId === work.threadId &&
        event.params.turn.id === work.turnId,
    );
    if (source)
      header(work, {
        kind: "event",
        event: source,
        index: events.indexOf(source),
      });
  }
  return result;
}

export const turnWorkKey = (thread: string, turn: string) =>
  `turn-work:${JSON.stringify([thread, turn])}`;
