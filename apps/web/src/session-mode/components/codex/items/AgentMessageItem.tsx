import { Streamdown } from "streamdown";
import { CopyButton } from "@session/components/common";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { useCodexStore } from "../stores/useCodexStore";

type AgentMessageItemProps = {
  text: string;
  threadId?: string;
};

export const AgentMessageItem = ({ text, threadId }: AgentMessageItemProps) => {
  const isWindowFocused = useWindowFocus();
  const projectRoot = useCodexStore(
    (state) => state.threads.find((thread) => thread.id === threadId)?.cwd,
  );

  if (!text.trim()) return null;

  return (
    <div
      className={`group flex flex-col items-start gap-1 ${text.includes("visualize") ? "w-full" : ""}`}
    >
      <div
        className={`${text.includes("visualize") ? "w-full" : "w-fit"} min-w-0 max-w-full overflow-x-auto rounded-md border p-2`}
      >
        <VisualizationContent
          text={text}
          projectRoot={projectRoot}
          renderMarkdown={(value) => <Streamdown>{value}</Streamdown>}
        />
      </div>
      <div
        className={`flex h-7 items-center gap-1 px-1 ${
          isWindowFocused
            ? "invisible group-hover:visible group-focus-within:visible"
            : "invisible"
        }`}
      >
        <CopyButton text={text} className="h-7 w-7 text-muted-foreground" />
      </div>
    </div>
  );
};
