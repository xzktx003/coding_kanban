import type { SeqEvent } from "./events.js";
import { object, type JsonObject } from "./json.js";
/** Task bookkeeping needs only identity/status; never retain tool items with completion events. */
export function projectRunEvent(event: SeqEvent): SeqEvent {
  if (event.event !== "codex:notification") return event;
  const params = object(event.payload.params),
    turn = object(params.turn),
    body: JsonObject = {};
  for (const key of ["threadId", "turnId", "willRetry"])
    if (key in params) body[key] = params[key];
  if (params.turn) {
    const summary: JsonObject = {};
    for (const key of ["id", "status"])
      if (key in turn) summary[key] = turn[key];
    body.turn = summary;
  }
  return { ...event, payload: { method: event.payload.method, params: body } };
}
