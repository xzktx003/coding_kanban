import { useMemo } from "react";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "../stores/useCodexStore";
import {
  streamingTranscriptPreview,
  transcriptPreview,
} from "./transcriptPreview";

const EMPTY_EVENTS: ServerNotification[] = [];

/** Exact-owner cached text remains readable; this is not a rich-body ready signal. */
export function CodexTranscriptPreparing({
  threadId,
  failed = false,
}: {
  threadId: string;
  failed?: boolean;
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
          ? "完整消息视图暂时无法加载，已保留近期正文和草稿。可显式刷新页面后重试。"
          : "正在准备完整消息视图…"}
      </p>
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div
            key={row.key}
            data-owner-thread={threadId}
            className={`whitespace-pre-wrap break-words leading-relaxed ${row.role === "user" ? "self-end max-w-[85%] rounded-2xl bg-muted px-4 py-2" : "w-full min-w-0"}`}
          >
            {row.text}
          </div>
        ))}
        {streaming && (
          <div
            data-owner-thread={threadId}
            className="whitespace-pre-wrap break-words leading-relaxed"
          >
            {streaming}
          </div>
        )}
      </div>
    </div>
  );
}
