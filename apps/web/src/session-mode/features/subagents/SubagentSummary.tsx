import { UsersRound } from "lucide-react";
import { useSubagentFamily } from "./hooks";
import { closeSubagents, openSubagents } from "./service";
import { useSubagentStore } from "./store";
import type { ChildState } from "./model";
import "./subagents.css";

const DONE: ReadonlySet<ChildState> = new Set([
  "completed",
  "failed",
  "stopped",
]);

export function SubagentSummary({ root }: { root: string | null }) {
  const { rows, family } = useSubagentFamily(root);
  const open = useSubagentStore((s) => !!root && s.panelRoot === root);
  if (!root) return null;
  const active = rows.filter((row) => !DONE.has(row.state));
  const uncertain =
    !family?.complete || rows.some((row) => row.state === "unknown");
  // Keep a stable, compact entry in the existing composer toolbar. A failed read
  // means unknown status, not evidence that a child was started.
  return (
    <button
      type="button"
      className="session-subagent-summary"
      data-subagent-root={root}
      aria-expanded={open}
      aria-label={`子智能体 · ${uncertain ? "待确认" : active.length}`}
      title={
        open
          ? "收起子智能体"
          : `查看子智能体 · ${uncertain ? "状态待确认" : `${active.length} 个活动中`}`
      }
      onClick={() => (open ? closeSubagents() : openSubagents(root, null))}
    >
      <UsersRound size={14} aria-hidden="true" />
      <span aria-hidden="true">{uncertain ? "?" : active.length}</span>
    </button>
  );
}
