import type { ServerNotification } from "../bindings";

export function userMessageKey(event: ServerNotification): string | undefined {
  if (
    (event.method !== "item/started" && event.method !== "item/completed") ||
    event.params.item.type !== "userMessage"
  )
    return;
  const item = event.params.item;
  return JSON.stringify([
    event.params.threadId,
    event.params.turnId,
    item.clientId || item.id,
  ]);
}

/** A completed item is sufficient evidence of a user message. Normalize it to
 * the existing started renderer, keeping one row for replay/history overlap. */
export function normalizeUserMessageEvents(
  events: ServerNotification[],
): ServerNotification[] {
  const expanded: ServerNotification[] = [];
  for (const event of events) {
    if (event.method === "turn/completed")
      for (const item of event.params.turn.items) {
        if (item.type === "userMessage")
          expanded.push({
            method: "item/started",
            params: {
              threadId: event.params.threadId,
              turnId: event.params.turn.id,
              item,
              startedAtMs: 0,
            },
          });
      }
    expanded.push(event);
  }
  // An older peer may omit clientId on one of the two item notifications.
  const clients = new Map<string, string>();
  for (const event of expanded) {
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      event.params.item.type === "userMessage" &&
      event.params.item.clientId
    )
      clients.set(
        JSON.stringify([
          event.params.threadId,
          event.params.turnId,
          event.params.item.id,
        ]),
        event.params.item.clientId,
      );
  }
  const seen = new Set<string>();
  const result: ServerNotification[] = [];
  for (const event of expanded) {
    if (
      (event.method !== "item/started" && event.method !== "item/completed") ||
      event.params.item.type !== "userMessage"
    ) {
      result.push(event);
      continue;
    }
    const item = event.params.item;
    const clientId =
      item.clientId ||
      clients.get(
        JSON.stringify([event.params.threadId, event.params.turnId, item.id]),
      ) ||
      null;
    const id = JSON.stringify([
      event.params.threadId,
      event.params.turnId,
      clientId || item.id,
    ]);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(
      event.method === "item/started" && clientId === item.clientId
        ? event
        : {
            method: "item/started",
            params: {
              threadId: event.params.threadId,
              turnId: event.params.turnId,
              item: { ...item, clientId },
              startedAtMs: 0,
            },
          },
    );
  }
  return result;
}
