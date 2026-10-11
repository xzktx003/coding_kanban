import { useCodexStore } from "@session/components/codex/stores";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const parentFinished = useCodexStore(
    (s) => codexRuntimeState(s, root).finished,
  );
  const open = useSubagentStore((s) => s.panelRoot === root);
  if (!root || (!rows.length && !family)) return null;
  const active = rows.filter((row) => !DONE.has(row.state));
  const uncertain =
    !family?.complete || rows.some((row) => row.state === "unknown");
  return (
    <div className="session-subagent-summary">
      <div className="session-subagent-summary-row">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"} 子任务 ·{" "}
          {uncertain ? "进行中待确认" : `进行中 ${active.length}`}
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => (open ? closeSubagents() : openSubagents(root))}
        >
          {open ? "收起子任务" : "查看子任务"}
        </button>
      </div>
      {parentFinished && active.length > 0 && (
        <small>主任务已结束 · 子任务仍在执行或等待处理</small>
      )}
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
