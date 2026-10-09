import type { ServerNotification } from "../bindings";
import { mergeThreadHistory } from "../utils/mergeThreadHistory";

function turnId(event: ServerNotification) {
  if (event.method === "turn/started" || event.method === "turn/completed")
    return event.params.turn.id;
  return "turnId" in event.params ? event.params.turnId : undefined;
}
/** A bounded page replaces only the turns it actually read. Stream changes win. */
export function mergeHistoryPage(
  page: ServerNotification[],
  before: ServerNotification[],
  current: ServerNotification[],
  turns: string[],
  earlier = false,
) {
  // An empty probe supplies no replacement turns. Preserve all concurrent
  // stream updates directly, without scanning or serializing the transcript.
  if (page.length === 0 && turns.length === 0) return current;
  const covered = new Set(turns);
  const retained = before.filter((event) => !covered.has(turnId(event) ?? ""));
  const firstCovered = before.findIndex((event) =>
    covered.has(turnId(event) ?? ""),
  );
  const snapshot =
    firstCovered >= 0
      ? [
          ...before.slice(0, firstCovered),
          ...page,
          ...before
            .slice(firstCovered)
            .filter((event) => !covered.has(turnId(event) ?? "")),
        ]
      : earlier
        ? [...page, ...retained]
        : [...retained, ...page];
  const merged = mergeThreadHistory(snapshot, before, current);
  // Avoid rerendering every visible transcript on a successful unchanged probe.
  if (merged.length !== current.length) return merged;
  for (let index = 0; index < merged.length; index++) {
    if (
      merged[index] !== current[index] &&
      JSON.stringify(merged[index]) !== JSON.stringify(current[index])
    )
      return merged;
  }
  return current;
}
