import type { ServerNotification } from "@session/bindings";
import type { StreamingAgentMessage } from "../stores/types";
import { copyTranscriptText } from "@session/services/codexTranscriptMemoryBudget";

export type TranscriptPreviewMessage = {
  key: string;
  role: "user" | "assistant";
  text: string;
};
const MAX_MESSAGES = 4;
const MESSAGE_CHARS = 4096;
const LIVE_CHARS = 8192;
const bounded = (value: string, limit: number) =>
  copyTranscriptText(
    value.length > limit ? `…${value.slice(-limit + 1)}` : value,
  );

/** Disposable text while the full renderer loads; never parses or keeps tool bodies. */
export function transcriptPreview(
  events: readonly ServerNotification[],
  threadId: string,
): TranscriptPreviewMessage[] {
  const rows: TranscriptPreviewMessage[] = [];
  const seen = new Set<string>();
  for (
    let index = events.length - 1;
    index >= 0 && rows.length < MAX_MESSAGES;
    index--
  ) {
    const event = events[index];
    if (event.method !== "item/completed" && event.method !== "item/started")
      continue;
    const { item, threadId: owner, turnId } = event.params;
    if (
      owner !== threadId ||
      (item.type !== "userMessage" && item.type !== "agentMessage")
    )
      continue;
    const key = JSON.stringify([owner, turnId, item.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    let text = "";
    if (item.type === "agentMessage") text = bounded(item.text, MESSAGE_CHARS);
    else {
      for (const part of item.content.slice(0, 64)) {
        if (part.type !== "text") continue;
        const remaining = MESSAGE_CHARS - text.length;
        if (remaining <= 1) break;
        text += (text ? "\n" : "") + bounded(part.text, remaining - 1);
      }
    }
    if (text.trim())
      rows.push({
        key,
        role: item.type === "userMessage" ? "user" : "assistant",
        text,
      });
  }
  return rows.reverse();
}

export function streamingTranscriptPreview(
  message?: StreamingAgentMessage,
): string {
  if (!message) return "";
  const segments = message.preview?.tail ?? message.segments;
  let text = bounded(
    message.preview?.tailCurrent ?? message.current,
    LIVE_CHARS,
  );
  for (
    let index = segments.length - 1;
    index >= 0 && text.length < LIVE_CHARS;
    index--
  )
    text = bounded(segments[index] + text, LIVE_CHARS);
  return bounded(text, LIVE_CHARS);
}
