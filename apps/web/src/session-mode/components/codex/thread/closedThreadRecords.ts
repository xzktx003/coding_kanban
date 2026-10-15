import type { ServerNotification } from "@session/bindings";

/** Derive from the loaded snapshot, never accumulate a second event cache. */
export function countClosedThreadRecords(
  events: readonly ServerNotification[],
  threadId: string,
): number {
  if (!threadId) return 0;
  let count = 0;
  for (const event of events) {
    if (event.method === "thread/closed" && event.params.threadId === threadId)
      count++;
  }
  return count;
}
