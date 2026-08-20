import { Suspense } from "react";

import {
  isLocalCodexSessionCandidate,
  type AgentSessionRecord,
} from "@agent-orchestrator/shared";

import { CardMoreMenu } from "./CardMoreMenu";
import { AgentGridTaskSummary } from "./AgentGridTaskSummary";
import { AgentGridGitSummary } from "./AgentGridGitSummary";
import { LazyTerminalView } from "./LazyTerminalView";
import { SessionGroupMenu } from "./SessionGroupControls";
import { TerminalPreview } from "./TerminalPreview";
import type { SessionGroupState } from "../lib/session-groups";

interface AgentGridCardProps {
  session: AgentSessionRecord;
  onDoubleClick: (id: string) => void;
  onDelete: (id: string) => void;
  onReconnect: (id: string) => void;
  onRename?: (id: string) => void;
  onHide?: (id: string) => void;
  onCopyConnectCommand?: (id: string) => void;
  onKillTmux?: (id: string) => void;
  onUnreadCompletionChange?: (id: string, unread: boolean) => void;
  sessionGroups?: SessionGroupState;
  onCreateSessionGroup?: (sessionId?: string) => void;
  onMoveSessionToGroup?: (sessionId: string, groupId: string | null) => void;
  terminalSuspended?: boolean;
  useLightweightTerminalPreview?: boolean;
  terminalFontSize?: number;
  onTerminalFontSizeChange?: (fontSize: number) => void;
}

const stateLabels: Record<string, string> = {
  running: "执行中",
  idle: "空闲",
  awaiting_input: "需响应",
  detached: "已分离",
  exited: "已退出",
};

const stateColors: Record<string, string> = {
  running: "card-running",
  idle: "card-idle",
  awaiting_input: "card-awaiting_input",
  detached: "card-detached",
  exited: "card-exited",
};

const interactiveDoubleClickSelectors = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
];

const TASK_SUMMARY_REFRESH_INTERVAL_MS = 15_000;
const GIT_SUMMARY_REFRESH_INTERVAL_MS = 60_000;

function getSummaryRefreshKey(
  session: AgentSessionRecord,
  intervalMs: number,
): string {
  const lastOutputAt = Date.parse(session.lastOutputAt ?? "");
  const outputBucket = Number.isFinite(lastOutputAt)
    ? Math.floor(lastOutputAt / intervalMs)
    : 0;
  return [
    session.id,
    session.workingDirectory ?? "",
    session.connectionState,
    outputBucket,
  ].join(":");
}

export function getAgentCardTaskSummaryRefreshKey(
  session: AgentSessionRecord,
): string {
  return getSummaryRefreshKey(session, TASK_SUMMARY_REFRESH_INTERVAL_MS);
}

export function getAgentCardGitSummaryRefreshKey(
  session: AgentSessionRecord,
): string {
  return getSummaryRefreshKey(session, GIT_SUMMARY_REFRESH_INTERVAL_MS);
}

export function shouldFocusGridCardFromDoubleClick(
  target: EventTarget | null,
): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (!element || typeof element.closest !== "function") {
    return true;
  }

  if (element.closest(".xterm-helper-textarea")) {
    return true;
  }

  return !interactiveDoubleClickSelectors.some((selector) =>
    element.closest?.(selector),
  );
}

export function shouldFocusGridCardFromMouseDown(
  detail: number,
  button: number,
  target: EventTarget | null,
): boolean {
  return (
    detail === 2 && button === 0 && shouldFocusGridCardFromDoubleClick(target)
  );
}

function shortenPath(dir?: string): string {
  if (!dir) return "";
  let p = dir;
  p = p.replace(/^\/(?:data\d+\/)?home\/[^/]+\//, "~/");
  if (p.startsWith("~/")) {
    const parts = p.slice(2).split("/").filter(Boolean);
    if (parts.length > 2) {
      return "~/" + parts.slice(-2).join("/");
    }
    return p;
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.length > 2) {
    return "…/" + parts.slice(-2).join("/");
  }
  return p;
}

export function AgentGridCard({
  session,
  onDoubleClick,
  onDelete,
  onReconnect,
  onRename,
  onHide,
  onCopyConnectCommand,
  onKillTmux,
  onUnreadCompletionChange,
  sessionGroups = { groups: [], assignments: {}, collapsedGroupIds: [] },
  onCreateSessionGroup,
  onMoveSessionToGroup,
  terminalSuspended = false,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
}: AgentGridCardProps) {
  const taskSummaryRefreshKey = getAgentCardTaskSummaryRefreshKey(session);
  const gitSummaryRefreshKey = getAgentCardGitSummaryRefreshKey(session);
  const needsCompletionReview = Boolean(session.hasUnreadCompletion);
  const stateClass = needsCompletionReview
    ? "card-review"
    : (stateColors[session.interactionState] ?? "");
  const stateLabel = needsCompletionReview
    ? "待验收"
    : (stateLabels[session.interactionState] ?? session.interactionState);
  const badgeState = needsCompletionReview
    ? "review"
    : session.interactionState;
  const isTmux = session.sourceType === "remote-tmux-discovered";
  const isTmuxManaged = Boolean(session.transportRef?.tmuxSession);
  const isExited = session.interactionState === "exited";
  const canReconnect = isExited && !isTmux;
  const canToggleUnread =
    session.interactionState !== "running" &&
    session.interactionState !== "awaiting_input";

  function getCloseTitle(): string {
    if (isTmux || isTmuxManaged) {
      return isExited ? "清除记录" : "脱离会话";
    }
    return isExited ? "清除记录" : "关闭会话";
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    const needsConfirm = !isTmux && !isTmuxManaged && !isExited;
    if (needsConfirm && !window.confirm("会话仍在运行中，确定关闭？")) {
      return;
    }
    onDelete(session.id);
  }

  function handleReconnect(e: React.MouseEvent) {
    e.stopPropagation();
    onReconnect(session.id);
  }

  return (
    <div
      className={`grid-card ${stateClass}`}
      onMouseDownCapture={(event) => {
        if (
          shouldFocusGridCardFromMouseDown(
            event.detail,
            event.button,
            event.target,
          )
        ) {
          onDoubleClick(session.id);
        }
      }}
    >
      <div className="grid-card-header">
        <div className="grid-card-title-group">
          <span className="grid-card-name">{session.displayName}</span>
        </div>
        <div className="grid-card-header-actions">
          <SessionGroupMenu
            session={session}
            sessionGroups={sessionGroups}
            onCreateGroup={onCreateSessionGroup}
            onMoveSessionToGroup={onMoveSessionToGroup}
          />
          <button
            className="grid-card-rename"
            onClick={(e) => {
              e.stopPropagation();
              onRename?.(session.id);
            }}
            title="修改名称"
            type="button"
          >
            ✎
          </button>
          {(isTmux || isTmuxManaged) && (
            <CardMoreMenu
              sessionId={session.id}
              isTmux={isTmux || isTmuxManaged}
              onCopyConnectCommand={(id) => onCopyConnectCommand?.(id)}
            />
          )}
          <span className={`grid-card-badge badge-${badgeState}`}>
            {stateLabel}
          </span>
          {canToggleUnread && onUnreadCompletionChange && (
            <button
              aria-label={needsCompletionReview ? "标记已读" : "标记未读"}
              className="grid-card-unread-toggle"
              onClick={(event) => {
                event.stopPropagation();
                onUnreadCompletionChange(session.id, !needsCompletionReview);
              }}
              title={needsCompletionReview ? "标记已读" : "标记未读"}
              type="button"
            >
              {needsCompletionReview ? "●" : "○"}
            </button>
          )}
          <button
            className="grid-card-hide"
            onClick={(e) => {
              e.stopPropagation();
              onHide?.(session.id);
            }}
            title="隐藏"
            type="button"
          >
            👁
          </button>
          {(isTmux || isTmuxManaged) && (
            <button
              className="grid-card-kill-tmux"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  window.confirm("确定要终止此 tmux 会话吗？这将杀掉底层进程。")
                ) {
                  onKillTmux?.(session.id);
                }
              }}
              title="终止 tmux 会话"
              type="button"
            >
              🗑
            </button>
          )}
          <button
            className="grid-card-close"
            onClick={handleClose}
            title={getCloseTitle()}
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      <AgentGridTaskSummary
        agentKind={session.agentKind}
        agentSessionId={session.id}
        supportsStructuredSummary={isLocalCodexSessionCandidate(session)}
        initialAgentSummary={session.lastAgentMessageSummary}
        initialUserSummary={session.lastUserMessageSummary}
        refreshKey={taskSummaryRefreshKey}
      />
      <AgentGridGitSummary
        refreshKey={gitSummaryRefreshKey}
        session={session}
      />
      <div className="grid-card-terminal">
        {useLightweightTerminalPreview ? (
          <TerminalPreview session={session} suspended={terminalSuspended} />
        ) : (
          <Suspense
            fallback={
              <TerminalPreview
                session={session}
                suspended={terminalSuspended}
              />
            }
          >
            <LazyTerminalView
              agentSessionId={session.id}
              interactive={false}
              fontSize={terminalFontSize}
              onFontSizeChange={onTerminalFontSizeChange}
              suspended={terminalSuspended}
            />
          </Suspense>
        )}
        {canReconnect && (
          <button className="grid-card-reconnect" onClick={handleReconnect}>
            🔄 重新连接
          </button>
        )}
      </div>
      <div className="grid-card-footer">
        <span className="grid-card-kind">{session.agentKind}</span>
        {isTmuxManaged && <span className="grid-card-tag">tmux</span>}
        {(session.tags ?? []).map((tag) => (
          <span key={tag} className="grid-card-tag grid-card-tag--user">
            {tag}
          </span>
        ))}
        <span className="grid-card-dir">
          {shortenPath(session.workingDirectory)}
        </span>
        <span className="grid-card-host">
          {session.hostId && session.hostId !== "local"
            ? session.hostId
            : "本地"}
        </span>
      </div>
    </div>
  );
}
