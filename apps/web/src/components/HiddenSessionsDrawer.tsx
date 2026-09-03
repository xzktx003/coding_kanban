import { useEffect } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  detached: "已分离",
  exited: "已退出",
};

interface HiddenSessionsDrawerProps {
  sessions: AgentSessionRecord[];
  open: boolean;
  onClose: () => void;
  onUnhide: (id: string) => void;
  onDelete: (id: string) => void;
}

function sortHiddenSessions(
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] {
  return [...sessions].sort((a, b) => {
    // Only sort by displayName (宫格名)
    return a.displayName.localeCompare(b.displayName);
  });
}

export function HiddenSessionsDrawer({
  sessions,
  open,
  onClose,
  onUnhide,
  onDelete,
}: HiddenSessionsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const sorted = sortHiddenSessions(sessions);

  const handleDelete = (s: AgentSessionRecord) => {
    const isExited = s.interactionState === "exited";
    if (!isExited && !window.confirm("会话仍在运行中，确定关闭？")) return;
    onDelete(s.id);
  };

  return (
    <div className="hidden-drawer-overlay" onClick={onClose}>
      <div className="hidden-drawer" onClick={(e) => e.stopPropagation()}>
        <h3>已隐藏的会话 ({sessions.length})</h3>
        {sorted.length === 0 ? (
          <div className="hidden-drawer-empty">没有隐藏的会话</div>
        ) : (
          sorted.map((s) => (
            <div key={s.id} className="hidden-drawer-item">
              <span className="hidden-drawer-name">{s.displayName}</span>
              <span className="hidden-drawer-kind">{s.agentKind}</span>
              <span className={`grid-card-badge badge-${s.interactionState}`}>
                {stateLabels[s.interactionState] ?? s.interactionState}
              </span>
              <div className="hidden-drawer-actions">
                <button type="button" onClick={() => onUnhide(s.id)}>
                  恢复
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => handleDelete(s)}
                >
                  关闭
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
