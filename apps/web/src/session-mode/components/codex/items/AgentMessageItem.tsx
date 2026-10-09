import { memo, useRef } from "react";
import { Streamdown } from "streamdown";
import { CopyButton } from "@session/components/common";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { useAnimationFrameValue } from "@session/hooks/useAnimationFrameValue";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { useCodexStore } from "../stores/useCodexStore";
import { MessageReferenceActions } from "../composer/v2/MessageReferenceActions";

type AgentMessageItemProps = {
  text: string;
  threadId?: string;
  itemId?: string;
};

const AgentMessageContent = memo(function AgentMessageContent({
  text,
  threadId,
  itemId,
  projectRoot,
}: AgentMessageItemProps & { projectRoot?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isWindowFocused = useWindowFocus();
  const hasVisualization = text.includes("visualize");

  return (
    <div
      className={`group flex flex-col items-start gap-1 ${hasVisualization ? "w-full" : ""}`}
    >
      <div
        ref={contentRef}
        className={`${hasVisualization ? "w-full" : "w-fit"} min-w-0 max-w-full overflow-x-auto rounded-md border p-2`}
      >
        <VisualizationContent
          text={text}
          projectRoot={projectRoot}
          renderMarkdown={(value) => <Streamdown>{value}</Streamdown>}
        />
      </div>
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
    </div>
  );
});

export const AgentMessageItem = ({
  text,
  threadId,
  itemId,
}: AgentMessageItemProps) => {
  const frameText = useAnimationFrameValue(text);
  const projectRoot = useCodexStore(
    (state) => state.threads.find((thread) => thread.id === threadId)?.cwd,
  );

  if (!frameText.trim()) return null;

  return (
    <AgentMessageContent
      text={frameText}
      threadId={threadId}
      itemId={itemId}
      projectRoot={projectRoot}
    />
  );
};
