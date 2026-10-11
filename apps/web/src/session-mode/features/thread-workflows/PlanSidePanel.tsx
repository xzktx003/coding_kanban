import { useSyncExternalStore } from "react";
import { CodexMarkdown as Markdown } from "@session/components/codex/presentation/CodexMarkdown";
import { planSidePanel } from "./planSidePanel";

export function PlanSidePanel() {
  const state = useSyncExternalStore(
    planSidePanel.subscribe,
    planSidePanel.get,
    planSidePanel.get,
  );
  if (!state) return null;
  return (
    <aside className="session-plan-side-panel" aria-label="计划">
      <header>
        <strong>计划</strong>
        <button type="button" onClick={() => planSidePanel.close()}>
          关闭计划侧边面板
        </button>
      </header>
      <div className="session-plan-side-body">
        <Markdown value={state.text} threadId={state.threadId} />
      </div>
    </aside>
  );
}
