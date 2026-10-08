import {
  subagentParent,
  normalizeSubagentThread,
  type SubagentThread,
  type SubagentStopTarget,
} from "@agent-orchestrator/shared";
import type { TurnTiming } from "@session/components/codex/stores/types";
import type { Thread, ThreadStatus } from "@session/bindings/v2";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
export interface SubagentNode {
  thread: SubagentThread;
  parentId: string;
  verified: boolean;
  createdInTurn?: string;
  objective?: string;
  revision: number;
  unavailable?: boolean;
}
export function descendants(nodes: Record<string, SubagentNode>, root: string) {
  return Object.values(nodes).filter((n) => {
    const seen = new Set<string>();
    let next: string | undefined = n.thread.id;
    while (next && next !== root) {
      if (seen.has(next)) return false;
      seen.add(next);
      next = nodes[next]?.parentId;
    }
    return next === root && n.thread.id !== root;
  });
}
export function inParentTurn(
  nodes: Record<string, SubagentNode>,
  root: string,
  node: SubagentNode,
  turn: string | null | undefined,
) {
  if (!turn) return false;
  const seen = new Set<string>();
  let current = node;
  while (current.parentId !== root) {
    if (seen.has(current.thread.id) || !nodes[current.parentId]) return false;
    seen.add(current.thread.id);
    current = nodes[current.parentId];
  }
  return current.createdInTurn === turn;
}
export function reconcileNodes(
  nodes: Record<string, SubagentNode>,
  threads: SubagentThread[],
  baseline: number,
) {
  const next = { ...nodes };
  for (const raw of threads) {
    const thread = normalizeSubagentThread(raw);
    const parent = subagentParent(thread);
    if (!parent) continue;
    const old = nodes[thread.id];
    next[thread.id] = {
      ...old,
      thread: {
        ...old?.thread,
        ...thread,
        ...(old && old.revision > baseline
          ? { status: old.thread.status, turns: old.thread.turns }
          : {}),
      },
      parentId: parent,
      verified: true,
      unavailable: false,
      revision: old?.revision ?? baseline,
    };
  }
  return next;
}
export type ChildState =
  | "running"
  | "pending"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped"
  | "unknown";
export function selectStopTargets(
  rows: Array<{
    node: SubagentNode;
    current: boolean;
    state: ChildState;
    turnId?: string;
  }>,
  history: boolean,
  id?: string,
  subtree = true,
): SubagentStopTarget[] {
  const branch = new Set(
    id
      ? [id]
      : rows.filter((r) => history || r.current).map((r) => r.node.thread.id),
  );
  if (id && subtree) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows)
        if (branch.has(r.node.parentId) && !branch.has(r.node.thread.id)) {
          branch.add(r.node.thread.id);
          changed = true;
        }
    }
  }
  return rows
    .filter(
      (r) =>
        branch.has(r.node.thread.id) &&
        !r.node.unavailable &&
        r.turnId &&
        ["running", "pending"].includes(r.state),
    )
    .map((r) => ({ threadId: r.node.thread.id, turnId: r.turnId! }));
}
export const CHILD_LABELS: Record<ChildState, string> = {
  running: "运行中",
  pending: "待处理",
  waiting: "待指示",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  unknown: "状态待确认",
};
export function childState(
  node: SubagentNode,
  timing: TurnTiming | undefined,
  pending: number,
): ChildState {
  if (pending) return "pending";
  if (node.unavailable) return "unknown";
  const last = timing ?? node.thread.turns?.at(-1);
  const fallback = node.thread.turns?.at(-1);
  const knownTurn =
    timing ??
    (fallback &&
    ["inProgress", "completed", "failed", "interrupted"].includes(
      fallback.status,
    )
      ? {
          turnId: fallback.id,
          status: fallback.status as TurnTiming["status"],
          startedAtMs: (fallback.startedAt ?? 0) * 1000,
          durationMs: null,
        }
      : undefined);
  const runtime = codexRuntimeState(
    {
      currentThreadId: null,
      currentTurnId: null,
      threads: [node.thread as Thread],
      threadStatusMap: node.thread.status
        ? { [node.thread.id]: node.thread.status as ThreadStatus }
        : {},
      turnTimingMap: knownTurn ? { [node.thread.id]: knownTurn } : {},
    },
    node.thread.id,
  );
  if (runtime.pending) return "pending";
  if (runtime.failed) return "failed";
  if (last?.status === "interrupted") return "stopped";
  if (runtime.running) return "running";
  if (last?.status === "completed") return "completed";
  if (node.thread.status?.type === "idle") return "waiting";
  return "unknown";
}
