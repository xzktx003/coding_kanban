import {
  mayContainStreamingMarkdown,
  StreamingCodexMarkdown,
} from "../presentation/StreamingCodexMarkdown";
import { memo, useEffect, useMemo, useRef } from "react";
import { NativeHookStats } from "./NativeHookStats";
import { NativeMemoryCitations } from "./NativeMemoryCitations";
import type { MemoryCitation } from "@session/bindings/v2/MemoryCitation";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import { CodexMarkdown } from "../presentation/CodexMarkdown";
import { NativeMessageCopy } from "@session/features/thread-workflows/NativeMessageCopy";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { MessageReferenceActions } from "../composer/v2/MessageReferenceActions";
import { NativeMessageFork } from "@session/features/thread-workflows/NativeMessageFork";
import { parseNativeReviewFindings } from "@session/features/git/nativeReviewFindings";
import { NativeReviewFindings } from "@session/features/git/NativeReviewFindings";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
import { STREAMING_TEXT_PREVIEW_MARKER } from "@session/services/codexTranscriptMemoryBudget";
import { useTranscriptInspection } from "../thread/inspection";
import { GoalCompletionBadge } from "@session/features/goals/GoalCompletionBadge";
import "@session/features/thread-workflows/native-message.css";

type AgentMessageItemProps = {
  text: string;
  threadId?: string;
  itemId?: string;
  turnId?: string;
  streaming?: boolean;
  alwaysShowActions?: boolean;
  phase?: string | null;
  hookRuns?: readonly HookRunSummary[];
  memoryCitation?: MemoryCitation | null;
  streamingSegments?: string[];
  streamingCurrent?: string;
  streamingPreview?: {
    head: string[];
    tail: string[];
    tailCurrent: string;
  };
};

export const AgentMessageItem = memo(function AgentMessageItem({
  text,
  threadId,
  itemId,
  turnId,
  streaming = false,
  alwaysShowActions = false,
  phase,
  hookRuns,
  memoryCitation,
  streamingSegments,
  streamingCurrent,
  streamingPreview,
}: AgentMessageItemProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isWindowFocused = useWindowFocus();
  const inspection = useTranscriptInspection();
  const owner = useCodexContentOwner(threadId);
  // The preview head stays immutable as more deltas arrive. Check it once so
  // plain huge output keeps the existing lightweight memory path. A native
  // directive or autolink can straddle two immutable 8Ki-character segments.
  const renderPreviewHead = useMemo(
    () =>
      streamingPreview?.head.some(
        (segment, index, head) =>
          mayContainStreamingMarkdown(segment) ||
          (index > 0 &&
            mayContainStreamingMarkdown(
              head[index - 1].slice(-32) + segment.slice(0, 32),
            )),
      ) ?? false,
    [streamingPreview?.head],
  );
  // Review directives use the final document. Live Markdown parses a bounded
  // tail and memoized stable blocks without joining the full streaming buffer.
  const review = useMemo(
    () =>
      streaming
        ? { markdown: "", findings: [] }
        : parseNativeReviewFindings(text, owner.cwd),
    [text, streaming, owner.cwd],
  );
  useEffect(() => {
    if (streaming || !threadId || !turnId || !itemId) return;
    useSavedTurnReviewStore.getState().projectFindings({
      threadId,
      turnId,
      itemId,
      cwd: owner.cwd,
      findings: review.findings,
    });
  }, [streaming, threadId, turnId, itemId, owner.cwd, review.findings]);

  if (
    !text.trim() &&
    !streamingSegments?.length &&
    !streamingCurrent &&
    !streamingPreview
  )
    return null;

  return (
    <div
      className="codex-assistant group flex flex-col items-start w-full min-w-0"
      data-message-author="assistant"
      data-phase={phase ?? undefined}
      data-streaming={streaming || undefined}
      data-owner-thread={threadId}
      data-owner-turn={turnId}
      data-owner-item={itemId}
    >
      <div
        ref={contentRef}
        className="codex-assistant-content w-full min-w-0 max-w-full"
      >
        {streaming ? (
          <div
            data-codex-streaming-text
            className="whitespace-pre-wrap break-words leading-relaxed"
          >
            {(!streamingPreview || renderPreviewHead) && (
              <StreamingCodexMarkdown
                key={`${threadId ?? ""}:${turnId ?? ""}:${itemId ?? ""}`}
                segments={streamingPreview?.head ?? streamingSegments}
                current={streamingPreview ? "" : (streamingCurrent ?? text)}
                threadId={threadId}
                markContainer={false}
              />
            )}
            {streamingPreview && (
              <>
                {!renderPreviewHead &&
                  streamingPreview.head.map((segment, index) => (
                    <span key={`head-${index}`}>{segment}</span>
                  ))}
                <span data-codex-streaming-truncated>
                  {STREAMING_TEXT_PREVIEW_MARKER}
                </span>
                {streamingPreview.tail.map((segment, index) => (
                  <span key={`tail-${index}`}>{segment}</span>
                ))}
                {streamingPreview.tailCurrent}
              </>
            )}
          </div>
        ) : (
          <>
            <CodexMarkdown value={review.markdown} threadId={threadId} />
            <NativeReviewFindings
              findings={review.findings}
              threadId={threadId}
              turnId={turnId}
              cwd={owner.cwd}
            />
          </>
        )}
      </div>
      {!streaming && (
        <div
          className={`session-message-actions codex-message-native-actions ${
            isWindowFocused
              ? alwaysShowActions && !inspection
                ? "visible"
                : "invisible group-hover:visible group-focus-within:visible"
              : "invisible"
          }`}
        >
          <NativeMessageCopy
            text={text}
            kind="assistant"
            contentRef={contentRef}
          />
          <NativeMessageFork
            threadId={threadId}
            turnId={turnId}
            itemId={itemId}
            contentRef={contentRef}
          />
          {hookRuns?.length ? <NativeHookStats runs={hookRuns} /> : null}
          <GoalCompletionBadge
            threadId={threadId}
            turnId={turnId}
            itemId={itemId}
          />
          <NativeMemoryCitations citation={memoryCitation} />
          <MessageReferenceActions
            text={text}
            threadId={threadId}
            itemId={itemId}
            contentRef={contentRef}
          />
        </div>
      )}
    </div>
  );
});
