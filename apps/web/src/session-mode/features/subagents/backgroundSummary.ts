import type { SubagentNode } from "./model";
import { childState, descendants, type ChildState } from "./model";
import type { TurnTiming } from "@session/components/codex/stores/types";

export interface BackgroundAgentRow {
  id: string;
  title: string;
  state: ChildState;
  label: string;
  model: string | null;
}

const labels: Record<ChildState, string> = {
  running: "处理中",
  pending: "处理中",
  waiting: "等待中",
  completed: "已完成",
  failed: "未成功",
  stopped: "已停止",
  unknown: "等待中",
};

export function backgroundAgentRows(
  nodes: Record<string, SubagentNode>,
  root: string | null,
  timings: Record<string, TurnTiming>,
): BackgroundAgentRow[] {
  if (!root) return [];
  return descendants(nodes, root).map((node) => {
    const state = childState(node, timings[node.thread.id], 0);
    return {
      id: node.thread.id,
      title: node.thread.name || node.thread.preview || node.thread.id,
      state,
      label: labels[state],
      model: node.thread.model ?? null,
    };
  });
}

export function backgroundAgentSummary(count: number) {
  return `子智能体 · ${count}`;
}
