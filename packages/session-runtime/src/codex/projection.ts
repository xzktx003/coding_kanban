import { projectCodexChatValue } from "@agent-orchestrator/shared";
import type { SeqEvent } from "../core/events.js";
import { object, type Json, type JsonObject } from "../core/json.js";

export type CodexHistoryView = "full" | "chat";
const privateReasoningFields = new Set([
  "encrypted_content",
  "encryptedContent",
  "text",
  "rawText",
]);

/**
 * Hide raw reasoning throughout nested thread/turn history, retaining public
 * summaries and every identity field. Tool bodies remain available to internal
 * consumers and explicit detail reads. Copy-on-change keeps unchanged snapshots
 * stable; no cache or retained transcript is created here.
 */
export function sanitizeCodexHistory<T extends Json>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((child) => {
      const next = sanitizeCodexHistory(child);
      changed ||= next !== child;
      return next;
    });
    return (changed ? result : value) as T;
  }
  const reasoning = value.type === "reasoning";
  let result: JsonObject | undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (reasoning && privateReasoningFields.has(key)) {
      result ??= { ...value };
      delete result[key];
      continue;
    }
    const next =
      reasoning && key === "content"
        ? Array.isArray(entry) && entry.length === 0
          ? entry
          : []
        : sanitizeCodexHistory(entry);
    if (next !== entry) {
      result ??= { ...value };
      result[key] = next;
    }
  }
  if (reasoning && !("content" in value)) {
    result ??= { ...value };
    result.content = [];
  }
  return (result ?? value) as T;
}

/** Invoke before publishing a native notification, after ownership bookkeeping. */
export function sanitizeCodexNotification(
  notification: JsonObject,
): JsonObject | null {
  const method = notification.method;
  if (
    method === "item/reasoning/textDelta" ||
    (method === "rawResponseItem/completed" &&
      object(object(notification.params).item).type === "reasoning")
  )
    return null;
  return sanitizeCodexHistory(notification);
}

/**
 * Browser boundary only. Do not apply this to the internal hub: automation,
 * collaboration and explicit tool detail reads need native tool bodies.
 * Actual approvals use separate event names and must retain their full schema.
 * Sequence numbers are never dropped or renumbered by the chat projection.
 */
export function projectCodexChatEvent(event: SeqEvent): SeqEvent {
  if (event.event !== "codex:notification") return event;
  const payload = projectCodexChatValue(event.payload) as JsonObject;
  return payload === event.payload ? event : { ...event, payload };
}

/**
 * An opt-in helper for an explicit runtime chat-history consumer. Apply to each
 * native turns/items page before accumulating pages, not after retaining a full
 * raw transcript. The existing Node gateway already projects `view=chat` reads;
 * it intentionally strips that view before forwarding to the runtime.
 */
export function projectCodexHistoryPage<T extends Json>(
  page: T,
  view: CodexHistoryView = "full",
): T {
  return view === "chat"
    ? (projectCodexChatValue(page) as T)
    : sanitizeCodexHistory(page);
}
