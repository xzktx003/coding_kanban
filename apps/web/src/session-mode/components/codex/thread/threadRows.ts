import type { ServerNotification } from "@session/bindings";
import {
  normalizeQuestionEvents,
  readQuestions,
} from "@session/features/async-questions/model";
import type { RenderEventContext } from "../items/fileChangeLogic";
import { deriveRenderItems, type RenderItem } from "./deriveRenderItems";
import { projectTranscriptItems } from "./projectTranscriptItems";
import {
  normalizeUserMessageEvents,
  userMessageKey,
} from "@session/utils/userMessageEvents";

export interface ThreadRow {
  key: string;
  item: RenderItem;
  context?: RenderEventContext;
}
const hiddenMethods = new Set([
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
  "item/reasoning/textDelta",
  "turn/started",
  "mcpServer/startupStatus/updated",
  "hook/started",
  "hook/completed",
]);
function turnIdOf(event: ServerNotification): string | undefined {
  if (event.method === "turn/completed") return event.params.turn.id;
  if ("turnId" in event.params) return event.params.turnId ?? undefined;
}

/** Index once per history update; row renderers never scan the entire transcript. */
export function buildThreadRows(events: ServerNotification[]): ThreadRow[] {
  events = normalizeQuestionEvents(normalizeUserMessageEvents(events));
  const projection = projectTranscriptItems(events);
  const laterTurns = new Set<string>();
  const rollbackCounts = new Map<number, number>();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const id = turnIdOf(event);
    if (
      event.method === "item/started" &&
      event.params.item.type === "userMessage"
    ) {
      rollbackCounts.set(
        i,
        laterTurns.size - (id && laterTurns.has(id) ? 1 : 0) + 1,
      );
    }
    if (
      id &&
      (event.method === "item/started" ||
        event.method === "item/completed" ||
        event.method === "turn/completed")
    )
      laterTurns.add(id);
  }
  const turns = new Map<string, ServerNotification[]>();
  const localIndices = new Map<number, number>();
  const turnsWithChanges = new Set<string>();
  events.forEach((event, index) => {
    const id = turnIdOf(event);
    if (!id) return;
    let turn = turns.get(id);
    if (!turn) {
      turn = [];
      turns.set(id, turn);
    }
    localIndices.set(index, turn.length);
    turn.push(event);
    if (
      (event.method === "turn/diff/updated" && event.params.diff.trim()) ||
      (event.method === "item/completed" &&
        event.params.item.type === "fileChange" &&
        event.params.item.changes.length > 0)
    )
      turnsWithChanges.add(id);
  });
  const collabCompleted = new Set(
    events.flatMap((event) =>
      event.method === "item/completed" &&
      ["collabAgentToolCall", "subAgentActivity"].includes(
        event.params.item.type,
      )
        ? [
            `${event.params.threadId}:${event.params.turnId}:${event.params.item.id}`,
          ]
        : [],
    ),
  );
  const seenCollab = new Set<string>();
  const rows: ThreadRow[] = [];
  for (const item of deriveRenderItems(events)) {
    if (item.kind === "cmdGroup") {
      rows.push({ key: item.key, item });
      continue;
    }
    const { index } = item;
    if (projection.hidden.has(index)) continue;
    const event = projection.replacements.get(index) ?? item.event;
    if (hiddenMethods.has(event.method)) continue;
    if (
      event.method === "item/started" &&
      [
        "agentMessage",
        "commandExecution",
        "enteredReviewMode",
        "exitedReviewMode",
        "sleep",
      ].includes(event.params.item.type)
    )
      continue;
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      ["collabAgentToolCall", "subAgentActivity"].includes(
        event.params.item.type,
      )
    ) {
      const key = `${event.params.threadId}:${event.params.turnId}:${event.params.item.id}`;
      if (
        (event.method === "item/started" && collabCompleted.has(key)) ||
        seenCollab.has(key)
      )
        continue;
      seenCollab.add(key);
    }
    if (event.method === "item/agentMessage/delta") {
      if (!event.params.delta.trim()) continue;
    }
    if (event.method === "item/started" || event.method === "item/completed") {
      const visibleItem = event.params.item;
      // These renderers return null until public content exists. Keep the
      // native lifecycle in the log without allocating padding or duplicate
      // reading anchors for an invisible item.
      if (
        (visibleItem.type === "reasoning" &&
          !visibleItem.summary.some((part) => part.trim())) ||
        (visibleItem.type === "plan" && !visibleItem.text.length) ||
        (visibleItem.type === "hookPrompt" &&
          !visibleItem.fragments.some((fragment) => Boolean(fragment.text)))
      )
        continue;
    }
    if (event.method === "item/plan/delta" && !event.params.delta.length)
      continue;
    if (event.method === "item/completed") {
      const completed = event.params.item;
      if (
        [
          "userMessage",
          "commandExecution",
          "enteredReviewMode",
          "exitedReviewMode",
          "sleep",
        ].includes(completed.type)
      )
        continue;
      if (
        completed.type === "agentMessage" &&
        !readQuestions(completed).length &&
        !completed.text.trim()
      )
        continue;
    }
    const renderTermination = projection.termination.get(index);
    let context: RenderEventContext | undefined = renderTermination
      ? { renderTermination }
      : undefined;
    if (
      event.method === "item/started" &&
      event.params.item.type === "userMessage"
    ) {
      context = { rollbackTurns: rollbackCounts.get(index) ?? 1 };
    }
    if (event.method === "turn/completed") {
      const turn = event.params.turn;
      if (
        turn.status !== "interrupted" &&
        turn.status !== "failed" &&
        !turnsWithChanges.has(turn.id) &&
        !turn.items.some(
          (item) => item.type === "fileChange" && item.changes.length > 0,
        )
      )
        continue;
      context = {
        events: turns.get(turn.id),
        eventIndex: localIndices.get(index),
      };
    }
    const userKey = userMessageKey(event);
    const itemId =
      event.method === "item/started" || event.method === "item/completed"
        ? event.params.item.id
        : "itemId" in event.params
          ? event.params.itemId
          : event.method === "turn/completed"
            ? event.params.turn.id
            : undefined;
    rows.push({
      key: userKey
        ? `user-${userKey}`
        : itemId
          ? `event-${turnIdOf(event) ?? ""}-${itemId}`
          : `event-${index}`,
      item: event === item.event ? item : { ...item, event },
      context,
    });
  }
  return rows;
}
