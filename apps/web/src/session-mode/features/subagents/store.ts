import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  subagentParent,
  normalizeSubagentThread,
  type SubagentSnapshot,
  type SubagentStopResult,
} from "@agent-orchestrator/shared";
import type { ServerNotification } from "@session/bindings";
import {
  descendants,
  isKnownRootThread,
  reconcileNodes,
  type SubagentNode,
} from "./model";
import { subagentScope, subagentStorageKey } from "./scope";
interface Family {
  complete: boolean;
  checkedAt: number;
  error?: string;
  loading?: boolean;
}
interface State {
  nodes: Record<string, SubagentNode>;
  families: Record<string, Family>;
  selection: Record<string, string | null>;
  /** Which Codex parent currently has the subagent sheet open. */
  panelRoot: string | null;
  stopResults: Record<string, SubagentStopResult[]>;
  revision: number;
  runtimeEpoch: number;
  scope: string;
  apply: (root: string, snapshot: SubagentSnapshot, baseline: number) => void;
}
export const useSubagentStore = create<State>()(
  persist(
    (set) => ({
      nodes: {},
      families: {},
      selection: {},
      panelRoot: null,
      stopResults: {},
      revision: 0,
      runtimeEpoch: 0,
      scope: subagentScope(),
      apply: (root, snapshot, baseline) =>
        set((s) => ({
          revision: s.revision + 1,
          nodes: Object.fromEntries(
            Object.entries(
              reconcileNodes(
                s.nodes,
                snapshot.threads,
                baseline,
                s.revision + 1,
              ),
            ).map(([id, node]) => [
              id,
              snapshot.unavailableIds?.includes(id) &&
              (s.nodes[id]?.metadataRevision ?? s.nodes[id]?.revision ?? 0) <=
                baseline
                ? {
                    ...node,
                    unavailable: true,
                    revision: s.revision + 1,
                    metadataRevision: s.revision + 1,
                    thread: { ...node.thread, canAcceptDirectInput: null },
                  }
                : node,
            ]),
          ),
          families: {
            ...s.families,
            [root]: {
              complete: snapshot.complete,
              checkedAt: snapshot.checkedAt,
              loading: false,
              error: snapshot.errors.join("；") || undefined,
            },
          },
        })),
    }),
    {
      name: subagentStorageKey(),
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        nodes: s.nodes,
        selection: s.selection,
        panelRoot: s.panelRoot,
      }),
      merge: (saved, current) => {
        const cached = saved as Partial<State>;
        return {
          ...current,
          scope: subagentScope(),
          revision: 0,
          families: {},
          stopResults: {},
          panelRoot: cached?.panelRoot ?? null,
          selection: cached?.selection ?? {},
          nodes: Object.fromEntries(
            Object.entries(cached?.nodes ?? {}).map(([id, node]) => [
              id,
              {
                ...node,
                unavailable: true,
                revision: 0,
                metadataRevision: 0,
                thread: {
                  ...node.thread,
                  status: { type: "notLoaded" },
                  turns: undefined,
                  canAcceptDirectInput: null,
                },
              },
            ]),
          ),
        };
      },
    },
  ),
);
const seenEvents = new WeakSet<object>();
const seenHistory = new WeakSet<readonly ServerNotification[]>();
/** Snapshots are immutable; unrelated session updates reuse the same array. */
export function observeSubagentHistory(events: readonly ServerNotification[]) {
  if (seenHistory.has(events)) return;
  seenHistory.add(events);
  for (const event of events) observeSubagents(event);
}
export function observeSubagents(event: ServerNotification) {
  if (seenEvents.has(event)) return;
  seenEvents.add(event);
  const p = event.params as any;
  const state = useSubagentStore.getState(),
    revision = state.revision + 1;
  let nodes = state.nodes;
  const canObserveChild = (id: string, parent: string) => {
    if (typeof id !== "string" || !id || typeof parent !== "string" || !parent)
      return false;
    const seen = new Set([id]);
    let next: string | undefined = parent;
    while (next) {
      if (seen.has(next)) return false;
      seen.add(next);
      next = nodes[next]?.parentId;
    }
    return true;
  };
  const update = (
    id: string,
    parent: string,
    data: Partial<SubagentNode>,
    thread: any = {},
  ) => {
    const old = nodes[id];
    nodes = {
      ...nodes,
      [id]: {
        ...old,
        ...data,
        unavailable: false,
        parentId: parent,
        revision,
        metadataRevision: data.metadataRevision ?? old?.metadataRevision ?? 0,
        verified: data.verified ?? old?.verified ?? false,
        thread: { ...old?.thread, ...thread, id },
      },
    };
  };
  if (event.method === "thread/started") {
    const parent = subagentParent(p.thread);
    if (parent)
      update(
        p.thread.id,
        parent,
        { verified: true, metadataRevision: revision },
        {
          ...normalizeSubagentThread(p.thread),
          canAcceptDirectInput: p.thread.canAcceptDirectInput ?? null,
        },
      );
    else if (isKnownRootThread(p.thread) && nodes[p.thread.id]) {
      nodes = { ...nodes };
      delete nodes[p.thread.id];
    }
  } else if (
    event.method === "item/started" ||
    event.method === "item/completed"
  ) {
    const item = p.item;
    if (item.type === "collabAgentToolCall") {
      for (const id of new Set<string>([
        ...(item.receiverThreadIds ?? []),
        ...Object.keys(item.agentsStates ?? {}),
      ])) {
        // A message/wait recipient may be the sender's parent or a sibling.
        // Only spawning establishes a new relationship.
        if (!nodes[id] && item.tool !== "spawnAgent") continue;
        const parent = nodes[id]?.parentId ?? item.senderThreadId ?? p.threadId;
        if (!canObserveChild(id, parent)) continue;
        const status = item.agentsStates?.[id]?.status;
        update(
          id,
          parent,
          {
            ...(item.tool === "spawnAgent"
              ? {
                  createdInTurn: nodes[id]?.createdInTurn ?? p.turnId,
                  objective: item.prompt ?? undefined,
                }
              : {}),
          },
          {
            ...(item.model ? { model: item.model } : {}),
            ...(item.reasoningEffort
              ? { reasoningEffort: item.reasoningEffort }
              : {}),
            ...(!nodes[id]?.verified && status
              ? {
                  status: {
                    type:
                      status === "running"
                        ? "active"
                        : status === "errored"
                          ? "systemError"
                          : "notLoaded",
                  },
                }
              : {}),
          },
        );
      }
    } else if (item.type === "subAgentActivity") {
      const id = item.agentThreadId;
      const parent = nodes[id]?.parentId ?? p.threadId;
      if ((nodes[id] || item.kind === "started") && canObserveChild(id, parent))
        update(id, parent, {
          ...(item.kind === "started"
            ? { createdInTurn: nodes[id]?.createdInTurn ?? p.turnId }
            : {}),
        });
    }
  }
  if (p.threadId && nodes[p.threadId]) {
    const node = nodes[p.threadId];
    if (event.method === "thread/status/changed")
      update(p.threadId, node.parentId, {}, { status: p.status });
    // Execution ordering is resolved by the existing Codex state parser, not a second state machine.
  }
  if (nodes !== state.nodes) useSubagentStore.setState({ nodes, revision });
}
export function observedIds(root: string) {
  return descendants(useSubagentStore.getState().nodes, root)
    .map((n) => n.thread.id)
    .slice(0, 200);
}
