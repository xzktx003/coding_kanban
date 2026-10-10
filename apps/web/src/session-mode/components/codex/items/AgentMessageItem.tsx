import { NativeHookStats } from "./NativeHookStats";
import { NativeMemoryCitations } from "./NativeMemoryCitations";
import type { MemoryCitation } from "@session/bindings/v2/MemoryCitation";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import { CodexMarkdown } from "../presentation/CodexMarkdown";
import { NativeMessageCopy } from "@session/features/thread-workflows/NativeMessageCopy";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { useEffect, useMemo, useRef } from "react";
import { MessageReferenceActions } from "../composer/v2/MessageReferenceActions";
import { NativeMessageFork } from "@session/features/thread-workflows/NativeMessageFork";
import { parseNativeReviewFindings } from "@session/features/git/nativeReviewFindings";
import { NativeReviewFindings } from "@session/features/git/NativeReviewFindings";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
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
};

export const AgentMessageItem = ({
  text,
  threadId,
  itemId,
  turnId,
  streaming = false,
  phase,
  hookRuns,
  memoryCitation,
}: AgentMessageItemProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const isWindowFocused = useWindowFocus();
  const owner = useCodexContentOwner(threadId);
  const review = useMemo(
    () => parseNativeReviewFindings(text, owner.cwd),
    [text, owner.cwd],
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

  if (!text.trim()) return null;

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
        <CodexMarkdown
          value={review.markdown}
          threadId={threadId}
          streaming={streaming}
        />
        <NativeReviewFindings
          findings={review.findings}
          threadId={threadId}
          turnId={turnId}
          cwd={owner.cwd}
        />
      </div>
      <div
        className={`session-message-actions codex-message-native-actions flex min-h-7 items-center gap-1 px-1 ${
          isWindowFocused
            ? "invisible group-hover:visible group-focus-within:visible"
            : "invisible"
        }`}
      >
        {!streaming && <NativeMessageCopy text={text} />}
        {!streaming && (
          <NativeMessageFork
            threadId={threadId}
            turnId={turnId}
            itemId={itemId}
            contentRef={contentRef}
          />
        )}
        {!streaming && hookRuns?.length ? (
          <NativeHookStats runs={hookRuns} />
        ) : null}
        <NativeMemoryCitations citation={memoryCitation} />
        <MessageReferenceActions
          text={text}
          threadId={threadId}
          itemId={itemId}
          contentRef={contentRef}
        />
      </div>
    </div>
  );
};
