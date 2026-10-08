import { useCodexStore } from "@session/components/codex/stores";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useState } from "react";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useSubagentFamily } from "./hooks";
import { openSubagents } from "./service";
import { CHILD_LABELS } from "./model";
import "./subagents.css";
export function SubagentSummary({ root }: { root: string | null }) {
  const { rows, family, turn } = useSubagentFamily(root);
  const [expanded, setExpanded] = useState(false);
  const layout = useLayoutStore();
  const parentFinished = useCodexStore(
    (s) => codexRuntimeState(s, root).finished,
  );
  if (!root || !rows.length) return null;
  const current = rows.filter((r) => r.current),
    active = rows.filter((r) => ["running", "pending"].includes(r.state));
  const pending = rows.reduce((n, r) => n + r.pending, 0);
  const uncertain =
    !family?.complete ||
    rows.some(
      (r) => r.state === "unknown" || (r.state === "pending" && !r.pending),
    );
  const count = (value: number) =>
    uncertain ? (value ? `${value}（已确认）` : "待确认") : value;
  return (
    <div className="session-subagent-summary">
      <div className="session-subagent-summary-row">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"}{" "}
          {!turn || rows.some((r) => !r.current && !r.node.createdInTurn)
            ? `已发现子任务 ${rows.length} · 本轮归属待确认`
            : `本轮子任务 ${current.length}`}{" "}
          · 运行 {count(active.filter((r) => r.state === "running").length)} ·
          待处理 {count(pending)}
          {!family?.complete ? " · 待确认" : ""}
        </button>
        <button
          type="button"
          onClick={() =>
            layout.activeRightPanelTab === "subagents" &&
            layout.isRightPanelOpen
              ? layout.setRightPanelOpen(false)
              : openSubagents(root)
          }
        >
          {" "}
          {layout.activeRightPanelTab === "subagents" && layout.isRightPanelOpen
            ? "收起子任务"
            : "查看子任务"}
        </button>
      </div>
      {parentFinished && active.length > 0 && (
        <small>主任务已结束 · 子任务仍在执行或等待处理</small>
      )}
      {expanded &&
        active.slice(0, 4).map((r) => (
          <button
            type="button"
            key={r.node.thread.id}
            onClick={() => openSubagents(root, r.node.thread.id)}
          >
            {r.node.thread.agentNickname ??
              r.node.thread.name ??
              r.node.thread.id.slice(0, 8)}{" "}
            · {CHILD_LABELS[r.state]}
          </button>
        ))}
    </div>
  );
}
