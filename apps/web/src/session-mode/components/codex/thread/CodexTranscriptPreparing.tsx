import { useMemo } from "react";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "../stores/useCodexStore";
import {
  streamingTranscriptPreview,
  transcriptPreview,
} from "./transcriptPreview";
import { TranscriptFallbackMarkdown } from "./TranscriptFallbackMarkdown";

const EMPTY_EVENTS: ServerNotification[] = [];

/** Exact-owner cached text remains readable; this is not a rich-body ready signal. */
export function CodexTranscriptPreparing({
  threadId,
  failed = false,
  failure,
  retryLabel = "重试完整消息",
  onRetry,
  onRefresh,
}: {
  threadId: string;
  failed?: boolean;
  failure?: string | null;
  retryLabel?: string;
  onRetry?: () => void;
  onRefresh?: () => void;
}) {
  const events = useCodexStore(
    (state) => state.events[threadId] ?? EMPTY_EVENTS,
  );
  const live = useCodexStore((state) => state.streamingAgentMessages[threadId]);
  const rows = useMemo(
    () => transcriptPreview(events, threadId),
    [events, threadId],
  );
  const streaming = useMemo(() => streamingTranscriptPreview(live), [live]);
  return (
    <div
      data-transcript-preparing={threadId}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
    >
      <p
        role={failed ? "alert" : "status"}
        className="text-xs text-muted-foreground mb-3"
      >
        {failed
          ? "完整消息视图暂时无法加载，近期正文和草稿仍已保留。可以重试加载；若仍失败，刷新页面后重新打开此会话。"
          : "正在准备完整消息视图…"}
      </p>
      {failed && (
        <>
          <div className="mb-3 flex flex-wrap gap-3">
            {onRetry && (
              <button
                type="button"
                className="text-sm text-primary underline underline-offset-2"
                onClick={onRetry}
              >
                {retryLabel}
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                className="text-sm text-primary underline underline-offset-2"
                onClick={onRefresh}
              >
                刷新页面
              </button>
            )}
          </div>
          {failure && (
            <details className="mb-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">查看错误详情</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all">
                {failure}
              </pre>
            </details>
          )}
        </>
      )}
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div
            key={row.key}
            data-owner-thread={threadId}
            className={`whitespace-pre-wrap break-words leading-relaxed ${row.role === "user" ? "self-end max-w-[85%] rounded-2xl bg-muted px-4 py-2" : "w-full min-w-0"}`}
          >
            <TranscriptFallbackMarkdown value={row.text} />
          </div>
        ))}
        {streaming && (
          <div
            data-owner-thread={threadId}
            className="whitespace-pre-wrap break-words leading-relaxed"
          >
            <TranscriptFallbackMarkdown value={streaming} />
          </div>
        )}
      </div>
    </div>
  );
}
