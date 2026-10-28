import type { CCMessage, ContentBlock, ToolResultBlock } from "../../types/messages";
import { isToolResultBlock } from "../../types/messages";

/**
 * Collects every tool_result from the user message that follows an assistant
 * message, keyed by tool_use_id.
 *
 * This is the superset of `collectInlineErrors`, which kept only `is_error`
 * results. The aligned cards summarize their own output — Grep's line count,
 * Edit's line delta, plan mode's approval — so they need successful results
 * too, not just failures.
 */
export function collectToolResults(
  messages: CCMessage[],
  idx: number,
): Record<string, ToolResultBlock> | undefined {
  const msg = messages[idx];
  if (msg.type !== "assistant") return undefined;

  // Skip stream events and system messages to reach the next real turn.
  let nextIdx = idx + 1;
  while (
    nextIdx < messages.length &&
    messages[nextIdx].type !== "user" &&
    messages[nextIdx].type !== "assistant"
  )
    nextIdx++;

  const next = messages[nextIdx];
  if (!next || next.type !== "user") return undefined;

  const blocks: ContentBlock[] = next.content ?? [];
  const hasToolResults = blocks.some(
    (block) => isToolResultBlock(block) && block.tool_use_id,
  );
  // No results yet means the tools are still running.
  if (!hasToolResults) return undefined;

  const results: Record<string, ToolResultBlock> = {};
  for (const block of blocks)
    if (isToolResultBlock(block) && block.tool_use_id)
      results[block.tool_use_id] = block;
  return results;
}

/** Pre-computes the per-message tool-result map for a whole transcript. */
export function buildToolResultsMap(
  messages: CCMessage[],
): Record<number, Record<string, ToolResultBlock>> {
  return messages.reduce<Record<number, Record<string, ToolResultBlock>>>(
    (acc, _, idx) => {
      const results = collectToolResults(messages, idx);
      if (results) acc[idx] = results;
      return acc;
    },
    {},
  );
}
