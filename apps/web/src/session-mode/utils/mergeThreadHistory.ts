import type { ServerNotification } from "../bindings";
import { normalizeUserMessageEvents } from "./userMessageEvents";

function identity(event: ServerNotification): string {
  const p = event.params;
  if (event.method === "item/started" || event.method === "item/completed")
    return JSON.stringify([
      event.params.threadId,
      event.params.turnId,
      "item",
      event.params.item.id,
    ]);
  if ("itemId" in p)
    return JSON.stringify([
      "threadId" in p ? p.threadId : "",
      "turnId" in p ? p.turnId : "",
      "item",
      p.itemId,
    ]);
  if (event.method === "turn/started" || event.method === "turn/completed")
    return JSON.stringify([
      event.params.threadId,
      event.params.turn.id,
      event.method,
    ]);
  return JSON.stringify([
    "threadId" in p ? p.threadId : "",
    "turnId" in p ? p.turnId : "",
    event.method,
  ]);
}

/** Ordinary history reads may fill older items, but cannot overwrite an item
 * changed by the stream during that read. Use the complete current item group
 * (not just its last delta), so compaction cannot duplicate or truncate text.
 * Explicit rollback bypasses this merge and replaces history deliberately. */
export function mergeThreadHistory(
  history: ServerNotification[],
  before: ServerNotification[],
  current: ServerNotification[],
): ServerNotification[] {
  if (before === current) return history;
  const baseline = new Set(before);
  const changed = new Set(
    current.filter((e) => !baseline.has(e)).map(identity),
  );
  const groups = new Map<string, ServerNotification[]>();
  for (const event of current) {
    const id = identity(event);
    if (!changed.has(id)) continue;
    const group = groups.get(id) ?? [];
    group.push(event);
    groups.set(id, group);
  }
  // On a cold join, the stream can start halfway through an assistant item.
  // A suffix alone must not replace the full text recovered from history.
  // Only prefer an unanchored delta group if it demonstrably includes that
  // snapshot as a prefix; never guess overlaps in repeated natural language.
  for (const event of history) {
    if (
      event.method !== "item/completed" ||
      event.params.item.type !== "agentMessage"
    )
      continue;
    const id = identity(event);
    const group = groups.get(id);
    if (
      !group?.length ||
      !group.every((e) => e.method === "item/agentMessage/delta")
    )
      continue;
    const text = group
      .map((e) =>
        e.method === "item/agentMessage/delta" ? e.params.delta : "",
      )
      .join("");
    if (!text.startsWith(event.params.item.text)) {
      groups.delete(id);
      changed.delete(id);
    }
  }
  const emitted = new Set<string>();
  const merged: ServerNotification[] = [];
  for (const event of history) {
    const id = identity(event);
    const live = groups.get(id);
    if (!live) merged.push(event);
    else if (!emitted.has(id)) {
      merged.push(...live);
      emitted.add(id);
    }
  }
  for (const event of current) {
    const id = identity(event);
    if (!changed.has(id) || emitted.has(id)) continue;
    merged.push(...groups.get(id)!);
    emitted.add(id);
  }
  return normalizeUserMessageEvents(merged);
}
