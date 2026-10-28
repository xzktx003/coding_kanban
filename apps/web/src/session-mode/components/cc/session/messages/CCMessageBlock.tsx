import { useState } from "react";
import { Streamdown } from "streamdown";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { Button } from "@session/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCCSettingsStore } from "@session/stores/settings";
import type { ContentBlock, ToolResultBlock } from "../../types/messages";
import { ToolCardView } from "../../presentation/cards";
import { ThinkingBlock } from "../../presentation/ThinkingBlock";
import type { ToolCardContext } from "../../presentation/ToolCard";
import { useCardContext } from "../../presentation/CardContext";

const SILENT_RESULT_TOOLS = ["Read", "Glob", "Grep"];

interface Props {
  block: ContentBlock;
  index: number;
  toolName?: string;
  inlineError?: ToolResultBlock | null;
  /** The result for this tool call, when it has arrived. */
  result?: ToolResultBlock | null;
  context?: ToolCardContext;
}

function stripErrorTags(s: string) {
  return s
    .replace(/^<tool_use_error>\s*/, "")
    .replace(/\s*<\/tool_use_error>$/, "");
}

export function CCMessageBlock({
  block,
  index,
  toolName,
  inlineError,
  result,
  context,
}: Props) {
  const blockKey = `block-${index}`;
  const [showWriteResult, setShowWriteResult] = useState(false);
  const { enabledThinking } = useCCSettingsStore();
  // Falls back to the provider so every card gets the host capabilities even
  // when a caller does not thread them explicitly.
  const providedContext = useCardContext();
  const cardContext = context ?? providedContext;

  switch (block.type) {
    case "text":
      return (
        <div key={blockKey} className="text-sm claude-presentation">
          <VisualizationContent
            text={block.text}
            renderMarkdown={(value) => <Streamdown>{value}</Streamdown>}
          />
        </div>
      );

    case "thinking":
      if (!enabledThinking) return null;
      return (
        <div key={blockKey} className="claude-presentation">
          <ThinkingBlock thinking={block.thinking} />
        </div>
      );

    // The official webview has no branch for this block type and falls
    // through to "Unsupported content type: redacted_thinking". That is a
    // dead path rather than intent, so we render it as a safely elided
    // thinking block instead. Documented divergence — see
    // docs/designs/claude-render-alignment/message-stream-contract-20261027.md
    case "redacted_thinking":
      if (!enabledThinking) return null;
      return (
        <div key={blockKey} className="claude-presentation">
          <ThinkingBlock redacted />
        </div>
      );

    case "tool_use":
      return (
        <div key={blockKey} className="claude-presentation">
          <ToolCardView
            block={block}
            result={result ?? inlineError ?? undefined}
            context={cardContext}
          />
        </div>
      );

    case "tool_result": {
      const isString = typeof block.content === "string";
      const content = block.content;

      if (
        content == null ||
        (isString && (content as string).trim().length === 0)
      )
        return null;
      // Cards that summarize their own result must not also dump it here.
      if (
        (toolName && SILENT_RESULT_TOOLS.includes(toolName)) ||
        (!toolName &&
          !block.is_error &&
          isString &&
          (content as string).length > 200)
      )
        return null;

      const isWriteTool = toolName === "Write";
      const isLongText = isString && (content as string).length > 500;
      const displayContent = isString
        ? stripErrorTags(content as string)
        : content;

      return (
        <div
          key={blockKey}
          className={`claude-presentation rounded-lg border p-3 max-w-full overflow-hidden ${block.is_error ? "border-red-500/20 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5"}`}
        >
          {isWriteTool && (
            <div className="flex justify-end mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWriteResult((p) => !p)}
                className="h-6 px-2 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1"
              >
                {showWriteResult ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showWriteResult ? "Hide" : "Output"}
              </Button>
            </div>
          )}
          {(!isWriteTool || showWriteResult) &&
            (isString ? (
              <div
                className={`text-xs whitespace-pre-wrap break-words overflow-auto text-foreground/80 ${isLongText ? "max-h-60" : ""}`}
              >
                {displayContent as string}
              </div>
            ) : (
              <pre className="text-xs overflow-auto max-h-60 break-all whitespace-pre-wrap font-mono bg-background/30 p-2 rounded">
                <code>{JSON.stringify(displayContent, null, 2)}</code>
              </pre>
            ))}
        </div>
      );
    }

    default:
      return (
        <div
          key={blockKey}
          className="claude-presentation rounded-lg border border-border bg-muted/30 p-3 max-w-full overflow-hidden"
        >
          <pre className="text-xs overflow-auto break-all whitespace-pre-wrap font-mono">
            <code>{JSON.stringify(block, null, 2)}</code>
          </pre>
        </div>
      );
  }
}
