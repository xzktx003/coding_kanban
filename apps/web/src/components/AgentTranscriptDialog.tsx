import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import type { AgentTranscriptResponse } from "@agent-orchestrator/shared";

import { getAgentTranscript } from "../lib/api";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
} from "../lib/terminal-font-size";

import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";

interface AgentTranscriptEntriesProps {
  terminalFontSize?: number;
  transcript: AgentTranscriptResponse;
}

interface AgentTranscriptDialogProps {
  agentSessionId: string;
  displayName: string;
  onClose: () => void;
  terminalFontSize?: number;
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? timestamp : value.toLocaleTimeString();
}

export function AgentTranscriptEntries({
  terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE,
  transcript,
}: AgentTranscriptEntriesProps) {
  if (!transcript.available) {
    return (
      <div className="agent-transcript-empty">
        {transcript.message ?? "当前会话没有可读取的完整记录。"}
      </div>
    );
  }

  const visibleEntries = [...transcript.entries]
    .filter(
      (entry) => entry.title !== "exec 调用" && entry.title !== "exec 输出",
    )
    .reverse();

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
        {visibleEntries.length === 0 ? (
          <div className="agent-transcript-empty">
            记录中还没有可展示的消息。
          </div>
        ) : (
          visibleEntries.map((entry) => {
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
      </div>
    </>
  );
}

export function AgentTranscriptDialog({
  agentSessionId,
  displayName,
  onClose,
  terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE,
}: AgentTranscriptDialogProps) {
  const [transcript, setTranscript] = useState<AgentTranscriptResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    void getAgentTranscript(agentSessionId)
      .then(setTranscript)
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error ? loadError.message : "完整记录加载失败",
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [agentSessionId]);

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
            <button disabled={loading} onClick={load} type="button">
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
            <AgentTranscriptEntries
              terminalFontSize={terminalFontSize}
              transcript={transcript}
            />
          ) : (
            <div className="agent-transcript-empty">正在读取 Codex 记录…</div>
          )}
        </div>
      </section>
    </div>
  );
}
