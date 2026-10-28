/**
 * Shared rendering primitives, aligned with the official Claude Code VS Code
 * extension 2.1.311 (`entry/chunk_z4.js`, `entry/chunk_L_0.js`, `entry.js`).
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §2
 */

import type { KeyboardEvent, MouseEvent } from "react";
import type { ContentBlock, ToolResultContent } from "../types/messages";

/** entry.js:3314 — the aria hint on a region that opens its full text. */
export const OPEN_IN_EDITOR_HINT =
  "Press Enter to open the full text in an editor tab";

/**
 * `Qk` (entry.js:3315). Content past this size becomes clickable, opening the
 * full text in an editor tab rather than growing the card.
 */
export function isBigContent(text: string): boolean {
  return text.length > 250 || text.split("\n").length > 3;
}

const NESTED_INTERACTIVE = 'button, [role="button"], a[href]';

export interface ActivatableProps {
  tabIndex?: number;
  "aria-description"?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  style?: { cursor: "pointer" };
}

/**
 * `GW` (entry/chunk_L_0.js). Makes a region activatable by click or keyboard
 * without swallowing interaction from controls nested inside it.
 *
 * Returns nothing when there is no handler, so the region stays inert — that
 * is how the official cards gate this on {@link isBigContent}.
 */
export function activatable(
  onActivate: (() => void) | undefined,
  hint: string = OPEN_IN_EDITOR_HINT,
): ActivatableProps {
  if (!onActivate) return {};
  return {
    tabIndex: 0,
    "aria-description": hint,
    onClick: ({ currentTarget, target }) => {
      if (!(target instanceof Element) || !currentTarget.contains(target))
        return;
      // A click on a nested control belongs to that control, not to us.
      const nested = target.closest(NESTED_INTERACTIVE);
      if (nested && nested !== currentTarget && currentTarget.contains(nested))
        return;
      onActivate();
    },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      // Holding the key must not fire repeatedly.
      if (!event.repeat) onActivate();
    },
    style: { cursor: "pointer" },
  };
}

/**
 * `toOutputContent` (entry/chunk_z4.js). Only text and tool_result carry
 * text; every other block type yields an empty string, which is what gates
 * the open-in-editor affordance on non-text results.
 */
export function toOutputText(
  block: ContentBlock | { type: string; [key: string]: unknown },
): string {
  if (block.type === "text") return String((block as { text?: string }).text ?? "");

  if (block.type === "tool_result") {
    const content = (block as { content?: ToolResultContent }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content
        .map((nested) =>
          toOutputText(nested as { type: string; [key: string]: unknown }),
        )
        .filter((text) => !!text)
        .join("\n");
    return "";
  }

  return "";
}

/** Normalizes a tool result's content to the text the OUT row should show. */
export function toolResultText(content: ToolResultContent | undefined): string {
  if (content === undefined) return "";
  return toOutputText({ type: "tool_result", tool_use_id: "", content });
}
