import { Suspense } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { CardMoreMenu } from "./CardMoreMenu";
import { LazyTerminalView } from "./LazyTerminalView";
import { TerminalPreview } from "./TerminalPreview";

interface AgentGridCardProps {
  session: AgentSessionRecord;
  onDoubleClick: (id: string) => void;
  onDelete: (id: string) => void;
  onReconnect: (id: string) => void;
  onRename?: (id: string) => void;
  onHide?: (id: string) => void;
  onCopyConnectCommand?: (id: string) => void;
  onKillTmux?: (id: string) => void;
  terminalSuspended?: boolean;
  useLightweightTerminalPreview?: boolean;
  terminalFontSize?: number;
  onTerminalFontSizeChange?: (fontSize: number) => void;
}

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  detached: "已分离",
  exited: "已退出",
};

const stateColors: Record<string, string> = {
  running: "card-running",
  idle: "card-idle",
  detached: "card-detached",
  exited: "card-exited",
};

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
  terminalSuspended = false,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
}: AgentGridCardProps) {
  const stateClass = stateColors[session.interactionState] ?? "";
  const stateLabel =
    stateLabels[session.interactionState] ?? session.interactionState;
  const isTmux = session.sourceType === "remote-tmux-discovered";
  const isTmuxManaged = Boolean(session.transportRef?.tmuxSession);
  const isExited = session.interactionState === "exited";
  const canReconnect = isExited && !isTmux;

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
      onDoubleClick={() => onDoubleClick(session.id)}
    >
      <div className="grid-card-header">
        <div className="grid-card-title-group">
          <span className="grid-card-name">{session.displayName}</span>
        </div>
        <div className="grid-card-header-actions">
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
          <span className={`grid-card-badge badge-${session.interactionState}`}>
            {stateLabel}
          </span>
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
          <span key={tag} className="grid-card-tag grid-card-tag--user">{tag}</span>
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
