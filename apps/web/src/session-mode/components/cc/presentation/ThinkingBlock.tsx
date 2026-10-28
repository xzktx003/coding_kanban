/**
 * Thinking block, aligned with the official Claude Code VS Code extension
 * 2.1.311 (`entry/chunk_O_0.js`, `entry.js:3249`).
 *
 * Two shapes: narration-signed thinking renders inline with a hint suffix and
 * no toggle; ordinary thinking uses a native <details> whose summary carries
 * the label and token count.
 *
 * Reference: docs/designs/claude-render-alignment/message-stream-contract-20261027.md §3
 */

import { Streamdown } from "streamdown";
import { narrationHintSuffix, thinkingLabel } from "./stream";

export interface ThinkingBlockProps {
  thinking?: string;
  /** Streaming, which switches the label to `Thinking...`. */
  isThinking?: boolean;
  durationMillis?: number;
  /** Live token estimate, appended to the summary while streaming. */
  tokenCount?: number;
  /** Narration-signed thinking renders inline rather than collapsible. */
  narration?: boolean;
  narrationHint?: string;
  /**
   * A `redacted_thinking` block. The official webview has no branch for this
   * and shows "Unsupported content type"; we render the elision instead.
   * Documented divergence.
   */
  redacted?: boolean;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
}

export function ThinkingBlock({
  thinking,
  isThinking = false,
  durationMillis,
  tokenCount,
  narration = false,
  narrationHint,
  redacted = false,
  expanded,
  onToggle,
}: ThinkingBlockProps) {
  if (redacted)
    return (
      <div className="claude-thinking claude-thinking-v2">
        <div className="claude-thinking-summary claude-thinking-static">
          <span>Thinking</span>
          <span className="claude-thinking-redacted-note">
            {" "}
            · redacted for safety
          </span>
        </div>
      </div>
    );

  if (narration) {
    const suffix = narrationHintSuffix(narrationHint);
    return (
      <div className="claude-narration-summary">
        <Streamdown>{thinking ?? ""}</Streamdown>
        {suffix ? (
          <span className="claude-narration-hint">{suffix}</span>
        ) : null}
      </div>
    );
  }

  const label = thinkingLabel({ isThinking, durationMillis });
  const count =
    isThinking && tokenCount !== undefined ? (
      <span className="claude-thinking-token-count"> · {tokenCount}</span>
    ) : null;

  // Empty thinking is a static, non-collapsible line: there is nothing to open.
  if (!thinking || thinking.trim().length === 0)
    return (
      <div className="claude-thinking claude-thinking-v2">
        <div className="claude-thinking-summary claude-thinking-static">
          <span>{label}</span>
          {count}
        </div>
      </div>
    );

  return (
    <details
      className="claude-thinking claude-thinking-v2"
      open={expanded}
      onToggle={(event) =>
        onToggle?.((event.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary className="claude-thinking-summary">
        <span>{label}</span>
        {count}
        <span
          className={`claude-thinking-toggle${
            expanded ? " claude-thinking-toggle-open" : ""
          }`}
          aria-hidden="true"
        />
      </summary>
      <div className="claude-thinking-content">
        <Streamdown>{thinking}</Streamdown>
      </div>
    </details>
  );
}
