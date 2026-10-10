import { useState } from "react";
import type { ThreadItem, TurnStatus } from "@session/bindings/v2";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";
import { ToolContent } from "../presentation/ToolContent";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
import {
  nativeMcpToolLabel,
  nativeToolJson,
  nativeMcpResultPresentation,
} from "../presentation/nativeToolSemantics";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
export function McpToolCallItem({
  item,
  termination,
}: {
  item: ThreadItem;
  termination?: TurnStatus;
}) {
  const { t, i18n } = useTranslation("thread"),
    [raw, setRaw] = useState(false);
  if (item.type !== "mcpToolCall") return null;
  const running = item.status === "inProgress" && !termination,
    language = i18n?.language ?? "zh",
    chinese = language.startsWith("zh");
  const label = nativeMcpToolLabel(item, language, !running),
    progress = (item as typeof item & { progressMessage?: string })
      .progressMessage;
  const rawLabel = chinese
    ? "显示原始工具调用输出"
    : "Show raw tool call output";
  const rawValue = {
    callId: item.id,
    invocation: {
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
    },
    durationMs: item.durationMs,
    result: item.result,
    error: item.error,
  };
  const error = item.error?.message;
  const presentation = nativeMcpResultPresentation(
    item.result?.content,
    item.result?.structuredContent,
  );
  const hasContent = !!presentation.content.length,
    structured = presentation.structured;
  return (
    <div className="codex-tool-call">
      <NativeToolDisclosure
        className="codex-native-mcp"
        icon={<NativeToolIcon name="mcp" />}
        summary={label}
        running={running}
      >
        {running && !item.result && !item.error && !termination ? null : (
          <>
            {error && <p role="alert">{error}</p>}
            {hasContent && <ToolContent content={presentation.content} />}
            {structured != null && (
              <pre className="codex-native-tool-json">
                {nativeToolJson(structured)}
              </pre>
            )}
            {!hasContent && structured == null && !error && (
              <p>
                {chinese ? "工具未返回任何内容" : "Tool returned no content"}
              </p>
            )}
            {termination && (
              <p role="status">
                {t(
                  termination === "interrupted"
                    ? "activity.interrupted"
                    : termination === "failed"
                      ? "activity.failed"
                      : "activity.ended",
                )}
              </p>
            )}
            <button
              type="button"
              className="codex-native-tool-raw-button"
              aria-label={rawLabel}
              onClick={() => setRaw(true)}
            >
              <NativeToolIcon name="raw" />
            </button>
          </>
        )}
      </NativeToolDisclosure>
      {progress && (
        <p role="status" className="codex-tool-progress">
          {progress}
        </p>
      )}
      <Dialog open={raw} onOpenChange={setRaw}>
        <DialogContent className="codex-file-preview max-w-[90vw] max-h-[90dvh] overflow-auto">
          <DialogTitle>
            {chinese
              ? `原始 ${item.server}.${item.tool} 工具调用输出`
              : `Raw ${item.server}.${item.tool} tool call output`}
          </DialogTitle>
          <pre className="codex-native-tool-json">
            {nativeToolJson(rawValue)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
