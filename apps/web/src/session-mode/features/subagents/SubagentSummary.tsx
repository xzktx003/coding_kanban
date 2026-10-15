import { useState } from "react";
import { useSubagentFamily } from "./hooks";
import { openSubagents } from "./service";
import type { ChildState } from "./model";
import "./subagents.css";

const DONE: ReadonlySet<ChildState> = new Set([
  "completed",
  "failed",
  "stopped",
]);

export function SubagentSummary({ root }: { root: string | null }) {
  const { rows, family } = useSubagentFamily(root);
  const [expanded, setExpanded] = useState(false);
  if (!root || (!rows.length && !family)) return null;
  const active = rows.filter((row) => !DONE.has(row.state));
  const uncertain =
    !family?.complete || rows.some((row) => row.state === "unknown");
  if (!uncertain && active.length === 0) return null;
  return (
    <div className="session-subagent-summary" role="region" aria-label="子智能体">
      <div className="session-subagent-summary-row">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"} 子智能体 ·{" "}
          {uncertain ? "已开启 · 待确认" : `已开启 · ${active.length}`}
        </button>
      </div>
      {expanded &&
        active.slice(0, 4).map((row) => (
          <button
            type="button"
            key={row.node.thread.id}
            onClick={() => openSubagents(root, row.node.thread.id)}
          >
            {row.node.thread.agentNickname ??
              row.node.thread.name ??
              row.node.thread.id.slice(0, 8)}
          </button>
        ))}
    </div>
  );
}
