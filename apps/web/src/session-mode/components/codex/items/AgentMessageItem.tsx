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
import "@session/features/thread-workflows/native-message.css";

type AgentMessageItemProps = {
  text: string;
  threadId?: string;
  itemId?: string;
  turnId?: string;
  streaming?: boolean;
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
  phase,
  hookRuns,
  memoryCitation,
  streamingSegments,
  streamingCurrent,
  streamingPreview,
}: AgentMessageItemProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isWindowFocused = useWindowFocus();
  const owner = useCodexContentOwner(threadId);
  // Keep live segments separate: review directives and Markdown are parsed only
  // after completion, without joining the bounded streaming buffer every token.
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
      data-phase={phase ?? undefined}
      data-streaming={streaming || undefined}
      data-owner-thread={threadId}
      data-owner-turn={turnId}
    >
      <div
        ref={contentRef}
        className="codex-assistant-content w-full min-w-0 max-w-full"
      >
        {streaming ? (
          <div
            data-codex-streaming-text
            className="whitespace-pre-wrap break-words text-sm leading-relaxed"
          >
            {streamingPreview ? (
              <>
                {streamingPreview.head.map((segment, index) => (
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
            ) : streamingSegments ? (
              <>
                {streamingSegments.map((segment, index) => (
                  <span key={index}>{segment}</span>
                ))}
                {streamingCurrent}
              </>
            ) : (
              text
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
          className={`session-message-actions codex-message-native-actions flex min-h-7 items-center gap-1 px-1 ${
            isWindowFocused
              ? "invisible group-hover:visible group-focus-within:visible"
              : "invisible"
          }`}
        >
          <NativeMessageCopy text={text} />
          <NativeMessageFork
            threadId={threadId}
            turnId={turnId}
            itemId={itemId}
            contentRef={contentRef}
          />
          {hookRuns?.length ? <NativeHookStats runs={hookRuns} /> : null}
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
