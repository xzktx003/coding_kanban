import type { ServerNotification } from "@session/bindings";
import { isTranscriptControlNotification } from "../presentation/transcriptControl";
const knownMethods = new Set([
  "error",
  "warning",
  "guardianWarning",
  "configWarning",
  "deprecationNotice",
  "model/rerouted",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/started",
  "item/completed",
  "turn/completed",
  "turn/plan/updated",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/terminalInteraction",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "thread/closed",
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
  "turn/moderationMetadata",
  "mcpServer/startupStatus/updated",
  "hook/started",
  "hook/completed",
]);
const knownItems = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "plan",
  "commandExecution",
  "hookPrompt",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
  "imageView",
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
  "sleep",
  "collabAgentToolCall",
  "subAgentActivity",
]);
export function isUnsupportedTranscriptEvent(
  event: ServerNotification,
): boolean {
  if (isTranscriptControlNotification(event.method)) return false;
  if (!knownMethods.has(event.method)) return true;
  if (event.method !== "item/started" && event.method !== "item/completed")
    return false;
  const params = record(event.params);
  return !knownItems.has(String(record(params.item).type));
}
export type TranscriptDiagnostic = {
  method: string;
  itemType?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
};
const smallText = (value: unknown) =>
  typeof value === "string" && value.length <= 512 ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Metadata only; opening this view never stringifies an unknown tool payload. */
export function transcriptDiagnostics(
  events: readonly ServerNotification[],
  owner: string,
): TranscriptDiagnostic[] {
  const records: TranscriptDiagnostic[] = [];
  for (const event of events) {
    if (!isUnsupportedTranscriptEvent(event)) continue;
    const params = record(event.params);
    if (typeof params.threadId === "string" && params.threadId !== owner)
      continue;
    const item =
      params.item && typeof params.item === "object"
        ? (params.item as Record<string, unknown>)
        : undefined;
    records.push({
      method: event.method.slice(0, 128),
      itemType: smallText(item?.type),
      threadId: smallText(params.threadId),
      turnId: smallText(params.turnId),
      itemId: smallText(item?.id ?? params.itemId),
    });
    if (records.length > 32) records.shift();
  }
  return records;
}
