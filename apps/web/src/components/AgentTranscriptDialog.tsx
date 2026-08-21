import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentTranscriptResponse } from "@agent-orchestrator/shared";

import { getAgentTranscript } from "../lib/api";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
} from "../lib/terminal-font-size";

import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";

interface AgentTranscriptEntriesProps {
  loadingMore?: boolean;
  onLoadMore?: () => void;
  terminalFontSize?: number;
  transcript: AgentTranscriptResponse;
  windowTrimmed?: boolean;
}

interface AgentTranscriptDialogProps {
  agentSessionId: string;
  displayName: string;
  onClose: () => void;
  terminalFontSize?: number;
  useLightweightTerminalPreview?: boolean;
}

export const AGENT_TRANSCRIPT_PAGE_SIZE = 30;
export const LIGHTWEIGHT_TRANSCRIPT_WINDOW_SIZE = 90;
export const FULL_TRANSCRIPT_WINDOW_SIZE = 300;

export function mergeTranscriptPage(
  current: AgentTranscriptResponse,
  olderPage: AgentTranscriptResponse,
  maxEntries: number,
): AgentTranscriptResponse {
  if (
    !current.available ||
    !olderPage.available ||
    current.sessionId !== olderPage.sessionId
  ) {
    return olderPage;
  }

  const seen = new Set<string>();
  const entries = [...olderPage.entries, ...current.entries].filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
  return {
    ...olderPage,
    entries: entries.slice(0, Math.max(1, maxEntries)),
  };
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? timestamp : value.toLocaleTimeString();
}

export function AgentTranscriptEntries({
  loadingMore = false,
  onLoadMore,
  terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE,
  transcript,
  windowTrimmed = false,
}: AgentTranscriptEntriesProps) {
  const orderedEntries = useMemo(
    () =>
      [...transcript.entries]
        .filter(
          (entry) => entry.title !== "exec 调用" && entry.title !== "exec 输出",
        )
        .reverse(),
    [transcript.entries],
  );

  if (!transcript.available) {
    return (
      <div className="agent-transcript-empty">
        {transcript.message ?? "当前会话没有可读取的完整记录。"}
      </div>
    );
  }

  return (
    <>
      <div className="agent-transcript-match">
        {transcript.matchedBy === "session-id"
          ? "按 Codex 会话 ID 精确匹配"
          : "按工作目录匹配最近的 Codex 会话"}
        {transcript.updatedAt
          ? ` · 更新于 ${formatTimestamp(transcript.updatedAt)}`
          : ""}
      </div>
      <div
        className="agent-transcript-list"
        style={
          {
            "--agent-transcript-font-size": `${clampTerminalFontSize(terminalFontSize)}px`,
          } as CSSProperties
        }
      >
        {orderedEntries.length === 0 ? (
          <div className="agent-transcript-empty">
            记录中还没有可展示的消息。
          </div>
        ) : (
          orderedEntries.map((entry) => {
            const content =
              entry.kind === "tool" ? (
                <pre
                  className="agent-transcript-text"
                  data-transcript-rendering="text"
                >
                  {entry.text}
                </pre>
              ) : (
                <div data-transcript-rendering="markdown">
                  <LazyMarkdownContent
                    className="agent-transcript-markdown"
                    content={entry.text}
                    deferUntilVisible
                    fallbackClassName="agent-transcript-markdown-loading"
                    fallbackText="正在渲染消息…"
                    testId="agent-transcript-markdown"
                  />
                </div>
              );
            return (
              <article
                className={`agent-transcript-entry agent-transcript-entry--${entry.kind}`}
                data-transcript-entry-id={entry.id}
                key={entry.id}
              >
                {entry.collapsedByDefault ? (
                  <details>
                    <summary>
                      <span>{entry.title}</span>
                      <time>{formatTimestamp(entry.timestamp)}</time>
                    </summary>
                    {content}
                  </details>
                ) : (
                  <>
                    <header>
                      <strong>{entry.title}</strong>
                      <time>{formatTimestamp(entry.timestamp)}</time>
                    </header>
                    {content}
                  </>
                )}
              </article>
            );
          })
        )}
        {transcript.hasMore || windowTrimmed ? (
          <div className="agent-transcript-load-more">
            <span>
              已加载 {orderedEntries.length} 条
              {windowTrimmed ? " · 已释放窗口外较新记录，刷新可回到最新" : ""}
            </span>
            {transcript.hasMore ? (
              <button disabled={loadingMore} onClick={onLoadMore} type="button">
                {loadingMore ? "加载中…" : "继续加载"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function AgentTranscriptDialog({
  agentSessionId,
  displayName,
  onClose,
  terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE,
  useLightweightTerminalPreview = true,
}: AgentTranscriptDialogProps) {
  const [transcript, setTranscript] = useState<AgentTranscriptResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [windowTrimmed, setWindowTrimmed] = useState(false);
  const requestIdRef = useRef(0);
  const maxRetainedEntries = useLightweightTerminalPreview
    ? LIGHTWEIGHT_TRANSCRIPT_WINDOW_SIZE
    : FULL_TRANSCRIPT_WINDOW_SIZE;

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    setWindowTrimmed(false);
    void getAgentTranscript(agentSessionId, {
      limit: AGENT_TRANSCRIPT_PAGE_SIZE,
    })
      .then((response) => {
        if (requestId === requestIdRef.current) {
          setTranscript(response);
        }
      })
      .catch((loadError: unknown) => {
        if (requestId === requestIdRef.current) {
          setError(
            loadError instanceof Error ? loadError.message : "完整记录加载失败",
          );
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, [agentSessionId]);

  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!transcript || transcript.entries.length <= maxRetainedEntries) {
      return;
    }
    setWindowTrimmed(true);
    setTranscript({
      ...transcript,
      entries: transcript.entries.slice(0, maxRetainedEntries),
    });
  }, [maxRetainedEntries, transcript]);

  const loadMore = useCallback(() => {
    if (!transcript?.hasMore || !transcript.nextCursor || loadingMore) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    void getAgentTranscript(agentSessionId, {
      cursor: transcript.nextCursor,
      limit: AGENT_TRANSCRIPT_PAGE_SIZE,
    })
      .then((olderPage) => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setWindowTrimmed(
          (current) =>
            current ||
            transcript.entries.length + olderPage.entries.length >
              maxRetainedEntries,
        );
        setTranscript((current) =>
          current
            ? mergeTranscriptPage(current, olderPage, maxRetainedEntries)
            : olderPage,
        );
      })
      .catch((loadError: unknown) => {
        if (requestId === requestIdRef.current) {
          setLoadMoreError(
            loadError instanceof Error ? loadError.message : "更早记录加载失败",
          );
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoadingMore(false);
        }
      });
  }, [agentSessionId, loadingMore, maxRetainedEntries, transcript]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="agent-transcript-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-label={`${displayName} 完整记录`}
        aria-modal="true"
        className="agent-transcript-dialog"
        role="dialog"
      >
        <header className="agent-transcript-header">
          <div>
            <strong>完整记录</strong>
            <span>{displayName}</span>
          </div>
          <div className="agent-transcript-actions">
            <button
              disabled={loading || loadingMore}
              onClick={load}
              type="button"
            >
              {loading ? "加载中…" : "刷新"}
            </button>
            <button onClick={onClose} type="button">
              关闭
            </button>
          </div>
        </header>
        <div className="agent-transcript-body">
          {error ? (
            <div className="agent-transcript-error" role="alert">
              {error}
            </div>
          ) : transcript ? (
            <>
              {loadMoreError ? (
                <div className="agent-transcript-error" role="alert">
                  {loadMoreError}
                </div>
              ) : null}
              <AgentTranscriptEntries
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                terminalFontSize={terminalFontSize}
                transcript={transcript}
                windowTrimmed={windowTrimmed}
              />
            </>
          ) : (
            <div className="agent-transcript-empty">正在读取 Codex 记录…</div>
          )}
        </div>
      </section>
    </div>
  );
}
