import { memo, useRef } from "react";
import { parseMarkdownIntoBlocks } from "streamdown";
import { CodexMarkdown } from "./CodexMarkdown";
import { copyTranscriptText } from "@session/services/codexTranscriptMemoryBudget";

export const STREAMING_MARKDOWN_TAIL_LIMIT = 16 * 1024;
const MAX_STABLE_BLOCKS = 128;
// Reference definitions can change earlier blocks. Keep their source intact
// during streaming and let the final, single-document renderer resolve them.
const needsDocumentContext =
  /(^|\n) {0,3}\[[^\]\n]+\]:|\[[^\]\n]*\]\[[^\]\n]*\]|\[\^[^\]\n]+\]/;
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
        this.stable.length >= MAX_STABLE_BLOCKS ||
        needsDocumentContext.test(value)
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
        this.raw.push(value);
        this.pending = "";
        this.overflow = true;
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
}
export function StreamingCodexMarkdown({
  segments = [],
  current = "",
  threadId,
}: {
  segments?: readonly string[];
  current?: string;
  threadId?: string;
}) {
  const cursor = useRef<StreamingBlocks | null>(null);
  if (!cursor.current) cursor.current = new StreamingBlocks();
  const state = cursor.current;
  state.update(segments);
  const boundedTail =
    !state.overflow &&
    state.pending.length + current.length <= STREAMING_MARKDOWN_TAIL_LIMIT &&
    !needsDocumentContext.test(state.pending + current);
  return (
    <div data-codex-streaming-text data-streaming-markdown>
      {state.stable.map((value, index) => (
        <StableMarkdown key={index} value={value} threadId={threadId} />
      ))}
      {boundedTail ? (
        <CodexMarkdown
          value={state.pending + current}
          threadId={threadId}
          streaming
        />
      ) : (
        <div
          className="whitespace-pre-wrap break-words leading-relaxed"
          data-streaming-markdown-plain
        >
          {state.raw.map((part, index) => (
            <span key={index}>{part}</span>
          ))}
          {state.pending}
          {current}
        </div>
      )}
    </div>
  );
}
