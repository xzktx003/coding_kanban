import type { ServerNotification } from "@session/bindings";
import type { ThreadItem, TurnStatus } from "@session/bindings/v2";

type TextItem = Extract<
  ThreadItem,
  { type: "agentMessage" | "plan" | "reasoning" }
>;
type Projection = {
  index: number;
  event: ServerNotification;
  done: boolean;
  text: string;
  summary: string[];
};

/** Keep the original event log and indices. Rendering projects one row per native item. */
export function projectTranscriptItems(events: ServerNotification[]) {
  const items = new Map<string, Projection>();
  const replacements = new Map<number, ServerNotification>();
  const hidden = new Set<number>();
  const termination = new Map<number, TurnStatus>();
  const byTurn = new Map<string, Set<string>>();
  const plans = new Map<string, number>();
  const tracked = new Set([
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "webSearch",
    "imageGeneration",
    "imageView",
    "contextCompaction",
  ]);
  const identity = (thread: string, turn: string, item: string) =>
    JSON.stringify([thread, turn, item]);
  const remember = (
    key: string,
    index: number,
    event: ServerNotification,
    text = "",
    summary: string[] = [],
    done = false,
  ) => {
    const previous = items.get(key);
    if (previous) hidden.add(index);
    const entry = {
      index: previous?.index ?? index,
      event,
      done,
      text,
      summary,
    };
    items.set(key, entry);
    replacements.set(entry.index, event);
    if ("threadId" in event.params && "turnId" in event.params) {
      const turn = JSON.stringify([event.params.threadId, event.params.turnId]);
      const keys = byTurn.get(turn) ?? new Set<string>();
      keys.add(key);
      byTurn.set(turn, keys);
    }
  };

  const finishTurn = (
    threadId: string,
    turnId: string,
    status: TurnStatus,
    finalItems: ThreadItem[] = [],
  ) => {
    const final = new Map(finalItems.map((item) => [item.id, item]));
    for (const key of byTurn.get(JSON.stringify([threadId, turnId])) ?? []) {
      const previous = items.get(key)!;
      if (previous.done && !termination.has(previous.index)) continue;
      const previousEvent = previous.event;
      const params = previousEvent.params;
      const itemId =
        previousEvent.method === "item/started" ||
        previousEvent.method === "item/completed"
          ? previousEvent.params.item.id
          : "itemId" in params && typeof params.itemId === "string"
            ? params.itemId
            : undefined;
      const snapshot = itemId ? final.get(itemId) : undefined;
      if (snapshot) {
        const safe =
          snapshot.type === "reasoning"
            ? { ...snapshot, content: [] }
            : snapshot;
        const event: ServerNotification = {
          method: "item/completed",
          params: { threadId, turnId, completedAtMs: 0, item: safe },
        };
        items.set(key, { ...previous, done: true, event });
        replacements.set(previous.index, event);
        termination.delete(previous.index);
      } else {
        // Render metadata only: an ended turn is not evidence of item success.
        termination.set(previous.index, status);
        items.set(key, { ...previous, done: true });
      }
    }
  };

  events.forEach((event, index) => {
    if (event.method === "turn/completed") {
      if (event.params.turn.status !== "inProgress")
        finishTurn(
          event.params.threadId,
          event.params.turn.id,
          event.params.turn.status,
          event.params.turn.items,
        );
      return;
    }
    if (
      event.method === "error" &&
      !event.params.willRetry &&
      event.params.turnId
    ) {
      finishTurn(event.params.threadId, event.params.turnId, "failed");
      return;
    }
    if (event.method === "turn/plan/updated") {
      const key = JSON.stringify([event.params.threadId, event.params.turnId]);
      const previous = plans.get(key);
      if (previous !== undefined) hidden.add(index);
      plans.set(key, previous ?? index);
      replacements.set(previous ?? index, event);
      return;
    }
    if (event.method === "item/mcpToolCall/progress") {
      const { threadId, turnId, itemId, message } = event.params;
      const key = identity(threadId, turnId, itemId);
      const previous = items.get(key);
      if (
        previous &&
        !previous.done &&
        (previous.event.method === "item/started" ||
          previous.event.method === "item/completed") &&
        previous.event.params.item.type === "mcpToolCall"
      ) {
        const snapshot = previous.event;
        const item = { ...snapshot.params.item, progressMessage: message };
        const updated =
          snapshot.method === "item/started"
            ? { ...snapshot, params: { ...snapshot.params, item } }
            : { ...snapshot, params: { ...snapshot.params, item } };
        remember(key, index, updated);
      } else if (previous?.done) hidden.add(index);
      return;
    }
    if (event.method === "item/reasoning/textDelta") {
      hidden.add(index);
      return;
    }
    if (
      event.method === "item/agentMessage/delta" ||
      event.method === "item/plan/delta"
    ) {
      const { threadId, turnId, itemId, delta } = event.params;
      const key = identity(threadId, turnId, itemId);
      const previous = items.get(key);
      if (previous?.done) {
        hidden.add(index);
        return;
      }
      const text = (previous?.text ?? "") + delta;
      remember(
        key,
        index,
        previous
          ? { ...event, params: { ...event.params, delta: text } }
          : event,
        text,
      );
      return;
    }
    if (
      event.method === "item/reasoning/summaryTextDelta" ||
      event.method === "item/reasoning/summaryPartAdded"
    ) {
      const { threadId, turnId, itemId, summaryIndex } = event.params;
      const key = identity(threadId, turnId, itemId);
      const previous = items.get(key);
      if (previous?.done) {
        hidden.add(index);
        return;
      }
      // Native indexes are nonnegative. Bound sparse/malformed protocol input.
      if (
        !Number.isInteger(summaryIndex) ||
        summaryIndex < 0 ||
        summaryIndex > 1000
      ) {
        hidden.add(index);
        return;
      }
      const summary = [...(previous?.summary ?? [])];
      summary[summaryIndex] =
        (summary[summaryIndex] ?? "") +
        (event.method === "item/reasoning/summaryTextDelta"
          ? event.params.delta
          : "");
      remember(
        key,
        index,
        {
          method: "item/started",
          params: {
            threadId,
            turnId,
            startedAtMs: 0,
            item: { type: "reasoning", id: itemId, summary, content: [] },
          },
        },
        "",
        summary,
      );
      return;
    }
    if (event.method !== "item/started" && event.method !== "item/completed")
      return;
    const { threadId, turnId, item } = event.params;
    if (tracked.has(item.type)) {
      const key = identity(threadId, turnId, item.id);
      if (items.get(key)?.done && event.method === "item/started") {
        hidden.add(index);
        return;
      }
      remember(key, index, event, "", [], event.method === "item/completed");
      if (event.method === "item/completed")
        termination.delete(items.get(key)!.index);
      return;
    }
    if (!["agentMessage", "plan", "reasoning"].includes(item.type)) return;
    const typed = item as TextItem;
    const key = identity(threadId, turnId, typed.id);
    const previous = items.get(key);
    if (event.method === "item/started") {
      if (typed.type === "plan") {
        if (previous) hidden.add(index);
        else remember(key, index, event, typed.text);
        return;
      }
      // Empty start is a grouping boundary, not another visible message.
      if (
        typed.type !== "reasoning" ||
        !typed.summary.some((part) => part.trim())
      )
        return;
      if (previous) {
        hidden.add(index);
        return;
      }
    }
    if (typed.type === "reasoning") {
      const safe = {
        ...event,
        params: { ...event.params, item: { ...typed, content: [] } },
      } as ServerNotification;
      remember(
        key,
        index,
        safe,
        "",
        typed.summary,
        event.method === "item/completed",
      );
    } else {
      // Final text can differ from every streamed delta (notably plan revisions).
      remember(
        key,
        index,
        event,
        typed.text,
        [],
        event.method === "item/completed",
      );
    }
    if (event.method === "item/completed")
      termination.delete(items.get(key)!.index);
  });
  return { replacements, hidden, termination };
}
