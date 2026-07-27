import { Suspense } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { LazyTerminalView } from "./LazyTerminalView";
import { SessionGroupMenu } from "./SessionGroupControls";
import { TerminalPreview } from "./TerminalPreview";
import type { SessionGroupState } from "../lib/session-groups";

interface FocusSidebarSessionCardProps {
  session: AgentSessionRecord;
  monitorIndex?: number;
  isActiveMonitor?: boolean;
  onSwitchFocus: (id: string) => void;
  onRename?: (id: string) => void;
  onDragStart?: (
    sessionId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  onDragEnd?: () => void;
  onContextMenu?: (
    session: AgentSessionRecord,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  sessionGroups?: SessionGroupState;
  onCreateSessionGroup?: (sessionId?: string) => void;
  onMoveSessionToGroup?: (sessionId: string, groupId: string | null) => void;
  useLightweightTerminalPreview?: boolean;
  terminalFontSize?: number;
  onTerminalFontSizeChange?: (fontSize: number) => void;
}

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  awaiting_input: "等待输入",
  detached: "已分离",
  exited: "已退出",
};

const pendingSidebarClickTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

export function FocusSidebarSessionCard({
  session,
  monitorIndex,
  isActiveMonitor = false,
  onSwitchFocus,
  onRename,
  onDragStart,
  onDragEnd,
  onContextMenu,
  sessionGroups = { groups: [], assignments: {}, collapsedGroupIds: [] },
  onCreateSessionGroup,
  onMoveSessionToGroup,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
}: FocusSidebarSessionCardProps) {
  const isTmuxManaged = Boolean(session.transportRef?.tmuxSession);

  const cancelPendingSingleClick = () => {
    const clickTimer = pendingSidebarClickTimers.get(session.id);
    if (!clickTimer) {
      return;
    }

    clearTimeout(clickTimer);
    pendingSidebarClickTimers.delete(session.id);
  };

  const switchFocusOnce = () => {
    cancelPendingSingleClick();
    onSwitchFocus(session.id);
  };

  const handleClick = () => {
    cancelPendingSingleClick();
    const clickTimer = setTimeout(() => {
      pendingSidebarClickTimers.delete(session.id);
      onSwitchFocus(session.id);
    }, 220);
    pendingSidebarClickTimers.set(session.id, clickTimer);
  };

  return (
    <div
      aria-current={isActiveMonitor ? "true" : undefined}
      className={`focus-sidebar-card card-${session.interactionState}${monitorIndex ? " focus-sidebar-card--monitored" : ""}${isActiveMonitor ? " focus-sidebar-card--monitor-active" : ""}`}
      data-active-monitor-session={isActiveMonitor ? "true" : undefined}
      data-monitor-index={monitorIndex}
      data-terminal-sidebar-menu-scope="other-session"
      data-session-id={session.id}
      draggable={Boolean(onDragStart)}
      onContextMenu={(event) => onContextMenu?.(session, event)}
      onDragEnd={onDragEnd}
      onDragStart={(event) => onDragStart?.(session.id, event)}
      onClick={handleClick}
      onDoubleClick={switchFocusOnce}
    >
      <div className="focus-sidebar-card-header">
        <div className="focus-sidebar-card-identity">
          {monitorIndex && (
            <span
              aria-label={`对应第 ${monitorIndex} 个监控窗格`}
              className="focus-sidebar-monitor-index"
            >
              {monitorIndex}
            </span>
          )}
          <span className="focus-sidebar-card-name">{session.displayName}</span>
          {isTmuxManaged && (
            <span
              aria-label="tmux 会话"
              className="focus-sidebar-transport-tag"
              title="tmux 会话"
            >
              tmux
            </span>
          )}
        </div>
        <div className="focus-sidebar-card-actions">
          <SessionGroupMenu
            session={session}
            sessionGroups={sessionGroups}
            onCreateGroup={onCreateSessionGroup}
            onMoveSessionToGroup={onMoveSessionToGroup}
          />
          <button
            className="grid-card-rename"
            onClick={(event) => {
              event.stopPropagation();
              onRename?.(session.id);
            }}
            title="修改名称"
            type="button"
          >
            ✎
          </button>
          <span className={`grid-card-badge badge-${session.interactionState}`}>
            {stateLabels[session.interactionState] ?? session.interactionState}
          </span>
        </div>
      </div>
      <div className="focus-sidebar-terminal">
        {useLightweightTerminalPreview ? (
          <TerminalPreview session={session} variant="sidebar" />
        ) : (
          <Suspense
            fallback={<TerminalPreview session={session} variant="sidebar" />}
          >
            <LazyTerminalView
              agentSessionId={session.id}
              fontSize={terminalFontSize}
              interactive={false}
              onFontSizeChange={onTerminalFontSizeChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
