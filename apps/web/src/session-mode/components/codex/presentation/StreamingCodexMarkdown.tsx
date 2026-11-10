import { memo, useRef } from "react";
import { parseMarkdownIntoBlocks } from "streamdown";
import { CodexMarkdown } from "./CodexMarkdown";
import { copyTranscriptText } from "@session/services/codexTranscriptMemoryBudget";
import { LiveMarkdownTail } from "./liveMarkdownTail";
import { prepareStreamingMarkdown } from "./prepareStreamingMarkdown";

export const STREAMING_MARKDOWN_TAIL_LIMIT = 16 * 1024;
const MAX_STABLE_BLOCKS = 128;
// Plain, very large output does not need a Markdown tree. In particular this
// keeps the existing large-stream memory path free of thousands of DOM nodes.
export const mayContainStreamingMarkdown = (value: string) =>
  /[*_`#>\[\]~$\\|<!]/.test(value) ||
  /(?:^|\n) {0,3}(?:[-+][ \t]|\d+[.)][ \t]|={2,}[ \t]*(?:\n|$)|-(?:[ \t]*-){2,}[ \t]*(?:\n|$))/.test(
    value,
  ) ||
  /https?:\/\/|www\./i.test(value) ||
  value.includes("@") ||
  value.includes("codex-file-citation") ||
  value.includes("【");
const StableMarkdown = memo(function StableMarkdown({
  value,
  threadId,
}: {
  value: string;
  threadId?: string;
}) {
  return <CodexMarkdown value={value} threadId={threadId} />;
});

/** A local, bounded parse cursor; no full-response join on a token update. */
class StreamingBlocks {
  segments: readonly string[] = [];
  stable: string[] = [];
  pending = "";
  raw: string[] = [];
  overflow = false;
  generation = 0;
  frozen: string | undefined;
  frozenLength = 0;
  update(segments: readonly string[]) {
    if (
      segments.length < this.segments.length ||
      this.segments.some((part, i) => part !== segments[i])
    ) {
      this.segments = [];
      this.stable = [];
      this.pending = "";
      this.raw = [];
      this.overflow = false;
      this.frozen = undefined;
      this.frozenLength = 0;
      this.generation++;
    }
    for (let i = this.segments.length; i < segments.length; i++) {
      const segment = segments[i];
      if (this.overflow) {
        this.raw.push(segment);
        continue;
      }
      const value = this.pending + segment;
      if (
        value.length > STREAMING_MARKDOWN_TAIL_LIMIT ||
        this.stable.length >= MAX_STABLE_BLOCKS
      ) {
        if (this.pending) this.raw.push(this.pending);
        this.raw.push(segment);
        this.pending = "";
        this.overflow = true;
        continue;
      }
      const blocks = parseMarkdownIntoBlocks(value);
      // Lexer drops reference definitions; never lose source in the projection.
      if (blocks.reduce((n, part) => n + part.length, 0) !== value.length) {
        this.pending = copyTranscriptText(value);
        continue;
      }
      let last = blocks.length - 1;
      while (last > 0 && !blocks[last].trim()) last--;
      const count = Math.min(last, MAX_STABLE_BLOCKS - this.stable.length);
      for (let j = 0; j < count; j++)
        this.stable.push(copyTranscriptText(blocks[j]));
      this.pending = copyTranscriptText(blocks.slice(count).join(""));
    }
    // Prefix references are already the bounded store strings, never copies of
    // a growing response. Replaced/truncated segments release the old cursor.
    this.segments = segments;
  }

  /** Freeze only a bounded, already displayed prefix before a raw overflow. */
  freeze(current: string) {
    if (!this.overflow) {
      if (this.pending) this.raw.push(this.pending);
      this.pending = "";
      this.overflow = true;
    }
    if (this.frozen !== undefined) return;
    const parts: string[] = [];
    let remaining = STREAMING_MARKDOWN_TAIL_LIMIT;
    for (const part of [...this.raw, current]) {
      if (!remaining) break;
      parts.push(part.slice(0, remaining));
      remaining -= Math.min(remaining, part.length);
    }
    const prefix = parts.join("");
    const formatted = mayContainStreamingMarkdown(prefix)
      ? prepareStreamingMarkdown(prefix)
      : "";
    this.frozen = copyTranscriptText(formatted);
    this.frozenLength = formatted.length;
  }
}
export function StreamingCodexMarkdown({
  segments = [],
  current = "",
  threadId,
  markContainer = true,
}: {
  segments?: readonly string[];
  current?: string;
  threadId?: string;
  markContainer?: boolean;
}) {
  const cursor = useRef<StreamingBlocks | null>(null);
  if (!cursor.current) cursor.current = new StreamingBlocks();
  const state = cursor.current;
  state.update(segments);
  const boundedTail =
    !state.overflow &&
    state.pending.length + current.length <= STREAMING_MARKDOWN_TAIL_LIMIT;
  if (!boundedTail) state.freeze(current);
  let skipped = state.frozenLength;
  const remainingParts = boundedTail
    ? []
    : [...state.raw, current].map((part) => {
        const count = Math.min(skipped, part.length);
        skipped -= count;
        return count ? part.slice(count) : part;
      });
  return (
    <div
      data-codex-streaming-text={markContainer ? "" : undefined}
      data-streaming-markdown
    >
      {state.stable.map((value, index) => (
        <StableMarkdown key={index} value={value} threadId={threadId} />
      ))}
      {boundedTail ? (
        <LiveMarkdownTail
          key={`${state.generation}:${state.stable.length}`}
          value={state.pending + current}
          threadId={threadId}
        />
      ) : (
        <>
          {state.frozen && (
            <CodexMarkdown value={state.frozen} threadId={threadId} streaming />
          )}
          <div
            className="whitespace-pre-wrap break-words leading-relaxed"
            data-streaming-markdown-plain
          >
            {remainingParts.map((part, index) => (
              <span key={index}>{part}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
