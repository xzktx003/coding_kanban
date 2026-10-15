import {
  subagentParent,
  normalizeSubagentThread,
  classifySubagentThread,
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
  /** Creation observations are discovery hints; only current native metadata confirms identity. */
  evidence?: "created" | "native" | "legacy";
  metadataRevision?: number;
}
export interface SubagentIdentity {
  thread: SubagentThread;
  revision: number;
  runtimeEpoch: number;
}
/** Observation caches retain metadata, never native turn items or large prompt strings. */
export function boundedSubagentThread(raw: SubagentThread): SubagentThread {
  const thread = normalizeSubagentThread(raw);
  const clipped = (value: string | null | undefined, length: number) =>
    typeof value === "string" ? ` ${value.slice(0, length)}`.slice(1) : value;
  const parent = subagentParent(thread);
  const kind = classifySubagentThread(thread);
  const source =
    typeof thread.source === "string"
      ? clipped(thread.source, 512)
      : kind === "child"
        ? { subAgent: {} }
        : kind === "main" && thread.source && typeof thread.source === "object"
          ? {
              custom: clipped(
                (thread.source as { custom?: string }).custom,
                512,
              ),
            }
          : undefined;
  return {
    id: thread.id,
    ...(source === undefined ? {} : { source }),
    ...(parent
      ? { parentThreadId: parent }
      : thread.parentThreadId === null
        ? { parentThreadId: null }
        : {}),
    agentNickname: clipped(thread.agentNickname, 160),
    agentRole: clipped(thread.agentRole, 160),
    name: clipped(thread.name, 512),
    preview: clipped(thread.preview, 1024) ?? undefined,
    model: clipped(thread.model, 512),
    reasoningEffort: clipped(thread.reasoningEffort, 160),
    cwd: clipped(thread.cwd, 4096),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    canAcceptDirectInput: thread.canAcceptDirectInput,
    historyMode: thread.historyMode,
    status: thread.status && {
      type: thread.status.type,
      ...(thread.status.activeFlags
        ? { activeFlags: thread.status.activeFlags.slice(0, 20) }
        : {}),
    },
    turns: thread.turns
      ?.slice(-1)
      .map(({ id, status, startedAt }) => ({ id, status, startedAt })),
  };
}
export function sameSubagentValue(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
export function validParentEdge(
  nodes: Record<string, SubagentNode>,
  id: string,
  parent: string,
) {
  if (!id || !parent || id === parent) return false;
  const seen = new Set([id]);
  let next: string | undefined = parent;
  while (next) {
    if (seen.has(next)) return false;
    seen.add(next);
    next = nodes[next]?.parentId;
  }
  return true;
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
  let next = nodes;
  for (const raw of threads) {
    const thread = boundedSubagentThread(raw);
    const old = next[thread.id];
    const newerMetadata =
      (old?.metadataRevision ?? (old?.verified ? old.revision : -1)) > baseline;
    if (classifySubagentThread(thread) === "main") {
      if (old && !newerMetadata) {
        next = { ...next };
        delete next[thread.id];
      }
      continue;
    }
    const parent = subagentParent(thread);
    if (!parent || !validParentEdge(next, thread.id, parent)) continue;
    const candidate: SubagentNode = {
      ...old,
      thread: {
        ...old?.thread,
        ...thread,
        ...(old && old.revision > baseline
          ? { status: old.thread.status, turns: old.thread.turns }
          : {}),
        ...(newerMetadata && old
          ? {
              source: old.thread.source,
              parentThreadId: old.thread.parentThreadId,
              canAcceptDirectInput: old.thread.canAcceptDirectInput,
            }
          : {}),
      },
      parentId: newerMetadata && old ? old.parentId : parent,
      verified: true,
      unavailable: newerMetadata && old ? old.unavailable : false,
      evidence: "native",
      metadataRevision: newerMetadata && old ? old.metadataRevision : baseline,
      revision: old?.revision ?? baseline,
    };
    if (
      !old ||
      !sameSubagentValue(old, {
        ...candidate,
        metadataRevision: old.metadataRevision,
      })
    )
      next = { ...next, [thread.id]: candidate };
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
