import { memo, useRef } from "react";
import { Streamdown } from "streamdown";
import { CopyButton } from "@session/components/common";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { useCodexStore } from "../stores/useCodexStore";
import { MessageReferenceActions } from "../composer/v2/MessageReferenceActions";
import { STREAMING_TEXT_PREVIEW_MARKER } from "@session/services/codexTranscriptMemoryBudget";

type AgentMessageItemProps = {
  text: string;
  threadId?: string;
  itemId?: string;
  streaming?: boolean;
  streamingSegments?: string[];
  streamingCurrent?: string;
  streamingPreview?: {
    head: string[];
    tail: string[];
    tailCurrent: string;
  };
};

const AgentMessageContent = memo(function AgentMessageContent({
  text,
  threadId,
  itemId,
  streaming = false,
  streamingSegments,
  streamingCurrent,
  streamingPreview,
  projectRoot,
}: AgentMessageItemProps & { projectRoot?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isWindowFocused = useWindowFocus();
  const hasVisualization = !streaming && text.includes("visualize");

  return (
    <div
      className={`group flex flex-col items-start gap-1 ${hasVisualization ? "w-full" : ""}`}
    >
      <div
        ref={contentRef}
        className={`${hasVisualization ? "w-full" : "w-fit"} min-w-0 max-w-full overflow-x-auto rounded-md border p-2`}
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
          <VisualizationContent
            text={text}
            projectRoot={projectRoot}
            renderMarkdown={(value) => <Streamdown>{value}</Streamdown>}
          />
        )}
      </div>
      {!streaming && (
        <div
          className={`session-message-actions flex min-h-7 items-center gap-1 px-1 ${
            isWindowFocused
              ? "invisible group-hover:visible group-focus-within:visible"
              : "invisible"
          }`}
        >
          <CopyButton text={text} className="h-7 w-7 text-muted-foreground" />
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

export const AgentMessageItem = ({
  text,
  threadId,
  itemId,
  streaming,
  streamingSegments,
  streamingCurrent,
  streamingPreview,
}: AgentMessageItemProps) => {
  const projectRoot = useCodexStore((state) =>
    streaming
      ? undefined
      : state.threads.find((thread) => thread.id === threadId)?.cwd,
  );

  if (
    !text.trim() &&
    !streamingSegments?.length &&
    !streamingCurrent &&
    !streamingPreview
  )
    return null;

  return (
    <AgentMessageContent
      text={text}
      threadId={threadId}
      itemId={itemId}
      streaming={streaming}
      streamingSegments={streamingSegments}
      streamingCurrent={streamingCurrent}
      streamingPreview={streamingPreview}
      projectRoot={projectRoot}
    />
  );
};
