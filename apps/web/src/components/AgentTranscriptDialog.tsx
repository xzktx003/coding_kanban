import type { CSSProperties, UIEvent } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
export const AGENT_TRANSCRIPT_SESSION_POLL_MS = 2_000;
export const LIGHTWEIGHT_TRANSCRIPT_WINDOW_SIZE = 90;
export const FULL_TRANSCRIPT_WINDOW_SIZE = 300;
export const AGENT_TRANSCRIPT_LOAD_THRESHOLD_PX = 160;

export function shouldLoadOlderTranscript(
  scrollTop: number,
  hasMore: boolean,
  loadingMore: boolean,
): boolean {
  return (
    hasMore && !loadingMore && scrollTop <= AGENT_TRANSCRIPT_LOAD_THRESHOLD_PX
  );
}

export function getTranscriptScrollTopAfterPrepend(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return Math.max(
    0,
    previousScrollTop + nextScrollHeight - previousScrollHeight,
  );
}

export function shouldReplaceTranscriptSession(
  currentSessionId: string | null,
  nextTranscript: AgentTranscriptResponse,
): boolean {
  return currentSessionId !== nextTranscript.sessionId;
}

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
  // Each server page is chronological; keep the newest entry at the bottom.
  const orderedEntries = useMemo(
    () =>
      [...transcript.entries].filter(
        (entry) => entry.title !== "exec 调用" && entry.title !== "exec 输出",
      ),
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
        {transcript.hasMore || windowTrimmed ? (
          <div className="agent-transcript-load-more agent-transcript-load-more--top">
            <span>
              {transcript.hasMore
                ? loadingMore
                  ? "正在加载更早记录…"
                  : "向上滚动可自动加载更早记录"
                : "已到最早记录"}
              {` · 已加载 ${orderedEntries.length} 条`}
              {windowTrimmed ? " · 已释放窗口外较新记录，刷新可回到最新" : ""}
            </span>
            {transcript.hasMore ? (
              <button disabled={loadingMore} onClick={onLoadMore} type="button">
                {loadingMore ? "加载中…" : "加载更早记录"}
              </button>
            ) : null}
          </div>
        ) : null}
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
  const sessionProbeIdRef = useRef(0);
  const transcriptSessionIdRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const transcriptBodyRef = useRef<HTMLDivElement | null>(null);
  const transcriptContentRef = useRef<HTMLDivElement | null>(null);
  const initialBottomPinRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  const maxRetainedEntries = useLightweightTerminalPreview
    ? LIGHTWEIGHT_TRANSCRIPT_WINDOW_SIZE
    : FULL_TRANSCRIPT_WINDOW_SIZE;

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(null);
    setLoadMoreError(null);
    setWindowTrimmed(false);
    initialBottomPinRef.current = true;
    pendingScrollRestoreRef.current = null;
    transcriptSessionIdRef.current = null;
    void getAgentTranscript(agentSessionId, {
      limit: AGENT_TRANSCRIPT_PAGE_SIZE,
    })
      .then((response) => {
        if (requestId === requestIdRef.current) {
          transcriptSessionIdRef.current = response.sessionId;
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
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    const probe = () => {
      if (loadingMoreRef.current) {
        return;
      }

      const probeId = ++sessionProbeIdRef.current;
      void getAgentTranscript(agentSessionId, {
        limit: AGENT_TRANSCRIPT_PAGE_SIZE,
      })
        .then((response) => {
          if (probeId !== sessionProbeIdRef.current) {
            return;
          }
          if (
            !shouldReplaceTranscriptSession(
              transcriptSessionIdRef.current,
              response,
            )
          ) {
            return;
          }

          requestIdRef.current += 1;
          transcriptSessionIdRef.current = response.sessionId;
          setLoading(false);
          loadingMoreRef.current = false;
          setLoadingMore(false);
          setLoadMoreError(null);
          setWindowTrimmed(false);
          initialBottomPinRef.current = true;
          pendingScrollRestoreRef.current = null;
          setTranscript(response);
        })
        .catch(() => {
          // A transient tmux/Codex lookup failure must not erase visible history.
        });
    };

    const timer = window.setInterval(probe, AGENT_TRANSCRIPT_SESSION_POLL_MS);
    return () => {
      sessionProbeIdRef.current += 1;
      window.clearInterval(timer);
    };
  }, [agentSessionId]);

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

  useLayoutEffect(() => {
    const body = transcriptBodyRef.current;
    if (!body || !transcript) {
      return;
    }

    const pending = pendingScrollRestoreRef.current;
    if (pending) {
      initialBottomPinRef.current = false;
      pendingScrollRestoreRef.current = null;
      body.scrollTop = getTranscriptScrollTopAfterPrepend(
        pending.scrollTop,
        pending.scrollHeight,
        body.scrollHeight,
      );
      return;
    }

    if (initialBottomPinRef.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    const body = transcriptBodyRef.current;
    const content = transcriptContentRef.current;
    if (
      !transcript ||
      !body ||
      !content ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    let animationFrame = 0;
    const keepLatestEntryVisible = () => {
      if (!initialBottomPinRef.current) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (initialBottomPinRef.current) {
          body.scrollTop = body.scrollHeight;
        }
      });
    };
    const resizeObserver = new ResizeObserver(keepLatestEntryVisible);
    resizeObserver.observe(content);
    keepLatestEntryVisible();
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [transcript?.sessionId]);

  const cancelInitialBottomPin = useCallback(() => {
    initialBottomPinRef.current = false;
  }, []);

  const loadMore = useCallback(() => {
    if (
      !transcript?.hasMore ||
      !transcript.nextCursor ||
      loadingMoreRef.current
    ) {
      return;
    }
    initialBottomPinRef.current = false;
    const body = transcriptBodyRef.current;
    pendingScrollRestoreRef.current = body
      ? {
          scrollTop: body.scrollTop,
          scrollHeight: body.scrollHeight,
        }
      : null;
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    loadingMoreRef.current = true;
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
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
  }, [agentSessionId, maxRetainedEntries, transcript]);

  const handleTranscriptScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const body = event.currentTarget;
      if (initialBottomPinRef.current) {
        const isAtBottom =
          body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
        if (isAtBottom) {
          return;
        }
        // Programmatic scrolls do not emit pointer or wheel events.
        initialBottomPinRef.current = false;
      }

      if (
        !transcript ||
        !shouldLoadOlderTranscript(
          body.scrollTop,
          transcript.hasMore,
          loadingMoreRef.current,
        )
      ) {
        return;
      }
      loadMore();
    },
    [loadMore, transcript],
  );

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

  const view = (
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
        <div
          className="agent-transcript-body"
          onScroll={handleTranscriptScroll}
          onPointerDown={cancelInitialBottomPin}
          onTouchStart={cancelInitialBottomPin}
          onWheel={cancelInitialBottomPin}
          ref={transcriptBodyRef}
        >
          <div ref={transcriptContentRef}>
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
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined"
    ? view
    : createPortal(view, document.body);
}
