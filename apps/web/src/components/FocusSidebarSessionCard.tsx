import { Suspense } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { LazyTerminalView } from "./LazyTerminalView";
import { SessionGroupMenu } from "./SessionGroupControls";
import { TerminalPreview } from "./TerminalPreview";
import type { SessionGroupState } from "../lib/session-groups";

interface FocusSidebarSessionCardProps {
  session: AgentSessionRecord;
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
  onSwitchFocus,
  onRename,
  onDragStart,
  onDragEnd,
  onContextMenu,
  sessionGroups = { groups: [], assignments: {} },
  onCreateSessionGroup,
  onMoveSessionToGroup,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
}: FocusSidebarSessionCardProps) {
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
      className={`focus-sidebar-card card-${session.interactionState}`}
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
        <span>{session.displayName}</span>
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
