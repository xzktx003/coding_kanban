import { useState } from "react";

const SEEN = "kanban.session.has-seen-multi-agent-composer-banner";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    // The current view still closes when storage is unavailable.
  }
}

export function MultiAgentComposerBanner({
  owner,
  threadId,
}: {
  owner: string;
  threadId: string | null;
}) {
  const [open, setOpen] = useState(() => threadId === null && !seen());
  if (!open || threadId !== null) return null;
  const close = () => {
    markSeen();
    setOpen(false);
  };
  return (
    <aside className="session-multi-agent-banner" aria-label="Codex 子代理">
      <span className="session-multi-agent-banner-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path d="M8 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm13 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM12 18.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 9.5 10.2 15M16 9.5 13.8 15" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
      <div className="session-multi-agent-banner-copy">
        <h2>Codex 子代理</h2>
        <p>把工作交给并行运行的子代理。注意：可能增加 token 用量。</p>
      </div>
      <div className="session-multi-agent-banner-actions">
        <button type="button" onClick={close}>立即试用</button>
        <button type="button" aria-label="关闭子代理提示" onClick={close}>×</button>
      </div>
    </aside>
  );
}
