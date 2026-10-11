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
  running: "正在运行",
  pending: "正在运行",
  waiting: "正在等待指示",
  completed: "已完成",
  failed: "已完成",
  stopped: "已完成",
  unknown: "正在等待指示",
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
  return `${count} 个后台智能体`;
}
