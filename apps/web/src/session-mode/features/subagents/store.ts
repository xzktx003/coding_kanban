import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  classifySubagentThread,
  type SubagentThread,
  type SubagentSnapshot,
  type SubagentStopResult,
} from "@agent-orchestrator/shared";
import type { ServerNotification } from "@session/bindings";
import {
  boundedSubagentThread,
  descendants,
  reconcileNodes,
  sameSubagentValue,
  validParentEdge,
  type SubagentIdentity,
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
  /** Current-runtime, bounded native metadata; never restored as permission from disk. */
  identities: Record<string, SubagentIdentity>;
  identityChecks: Record<string, { loading: boolean; error?: string }>;
  families: Record<string, Family>;
  selection: Record<string, string | null>;
  /** Which Codex parent currently has the subagent sheet open. */
  panelRoot: string | null;
  stopResults: Record<string, SubagentStopResult[]>;
  revision: number;
  runtimeEpoch: number;
  scope: string;
  apply: (
    root: string,
    snapshot: SubagentSnapshot,
    baseline: number,
    observationFence?: number,
  ) => void;
}
export const useSubagentStore = create<State>()(
  persist(
    (set) => ({
      nodes: {},
      identities: {},
      identityChecks: {},
      families: {},
      selection: {},
      panelRoot: null,
      stopResults: {},
      revision: 0,
      runtimeEpoch: 0,
      scope: subagentScope(),
      apply: (root, snapshot, baseline, observationFence) =>
        set((s) => {
          const changes = metadataChanges(
            s,
            snapshot.threads,
            baseline,
            observationFence,
          );
          const unavailable = snapshot.unavailableIds ?? [];
          let nodes = changes.nodes;
          for (const id of unavailable) {
            const node = nodes[id];
            if (
              node &&
              (node.metadataRevision ?? 0) <= baseline &&
              (nativeObservationFences.get(id) ?? 0) <=
                (observationFence ?? captureSubagentMetadataFence()) &&
              (!node.unavailable || node.thread.canAcceptDirectInput !== null)
            )
              nodes = {
                ...nodes,
                [id]: {
                  ...node,
                  unavailable: true,
                  metadataRevision: s.revision + 1,
                  revision: s.revision + 1,
                  thread: { ...node.thread, canAcceptDirectInput: null },
                },
              };
          }
          const family: Family = {
            complete: snapshot.complete,
            checkedAt: s.families[root]?.checkedAt ?? snapshot.checkedAt,
            loading: false,
            error: snapshot.errors.join("；") || undefined,
          };
          const changedFamily = !sameSubagentValue(s.families[root], family);
          if (
            nodes === s.nodes &&
            changes.identities === s.identities &&
            !changedFamily
          )
            return s;
          return {
            ...changes,
            nodes,
            revision:
              nodes !== s.nodes && changes.revision === s.revision
                ? s.revision + 1
                : changes.revision,
            families: changedFamily
              ? {
                  ...s.families,
                  [root]: { ...family, checkedAt: snapshot.checkedAt },
                }
              : s.families,
          };
        }),
    }),
    {
      name: subagentStorageKey(),
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        nodes: s.nodes,
        selection: s.selection,
        panelRoot: s.panelRoot,
      }),
      migrate: (saved) => saved,
      merge: (saved, current) => {
        const cached = saved as Partial<State>;
        return {
          ...current,
          scope: subagentScope(),
          revision: 0,
          families: {},
          identities: {},
          identityChecks: {},
          stopResults: {},
          panelRoot: cached?.panelRoot ?? null,
          selection: cached?.selection ?? {},
          nodes: restoreCandidateNodes(cached?.nodes ?? {}),
        };
      },
    },
  ),
);
function restoreCandidateNodes(cached: Record<string, SubagentNode>) {
  const nodes: Record<string, SubagentNode> = {};
  for (const [id, node] of Object.entries(cached)) {
    if (
      !node?.thread ||
      node.thread.id !== id ||
      typeof node.parentId !== "string"
    )
      continue;
    // A cached main source proves a communication edge false, but a missing
    // source cannot prove the child is a main thread. Remaining clues need a read.
    if (
      classifySubagentThread(node.thread) === "main" ||
      !validParentEdge(cached, id, node.parentId)
    )
      continue;
    nodes[id] = {
      parentId: node.parentId,
      createdInTurn:
        typeof node.createdInTurn === "string"
          ? node.createdInTurn.slice(0, 512)
          : undefined,
      objective:
        typeof node.objective === "string"
          ? ` ${node.objective.slice(0, 1024)}`.slice(1)
          : undefined,
      thread: {
        ...boundedSubagentThread(node.thread),
        status: { type: "notLoaded" },
        turns: undefined,
        canAcceptDirectInput: null,
      },
      verified: false,
      evidence: "legacy",
      unavailable: true,
      revision: 0,
      metadataRevision: 0,
    };
  }
  return nodes;
}
// A newer live observation must fence older reads even when its fields are
// unchanged. Keep that ordering separate from UI snapshots and body stores.
let metadataObservationClock = 0;
const nativeObservationFences = new Map<string, number>();
export function captureSubagentMetadataFence() {
  return metadataObservationClock;
}
export function resetSubagentMetadataFences() {
  metadataObservationClock = 0;
  nativeObservationFences.clear();
}
function metadataChanges(
  state: State,
  threads: SubagentThread[],
  baseline: number,
  observationFence = captureSubagentMetadataFence(),
) {
  // Native identity also leaves a main-thread tombstone, so an older snapshot
  // or replayed spawn cannot resurrect the removed observation node.
  const accepted = threads.filter(
    (thread) =>
      typeof thread?.id === "string" &&
      (state.identities[thread.id]?.revision ?? -1) <= baseline &&
      (nativeObservationFences.get(thread.id) ?? 0) <= observationFence,
  );
  let nodes = reconcileNodes(state.nodes, accepted, baseline);
  let identities = state.identities;
  const revision = state.revision + 1;
  for (const raw of accepted) {
    const {
      turns: _turns,
      preview: _preview,
      status: _status,
      ...thread
    } = boundedSubagentThread(raw);
    const previous = identities[thread.id];
    if (
      !sameSubagentValue(previous?.thread, thread) ||
      previous?.runtimeEpoch !== state.runtimeEpoch
    ) {
      identities = {
        ...identities,
        [thread.id]: { thread, revision, runtimeEpoch: state.runtimeEpoch },
      };
    }
    const node = nodes[thread.id];
    if (
      node &&
      classifySubagentThread(thread) === "child" &&
      !sameSubagentValue(state.nodes[thread.id], node)
    ) {
      nodes = {
        ...nodes,
        [thread.id]: { ...node, metadataRevision: revision, revision },
      };
    }
  }
  return {
    nodes,
    identities,
    revision:
      nodes !== state.nodes || identities !== state.identities
        ? revision
        : state.revision,
  };
}
export function hasNewerSubagentMetadata(
  id: string,
  baseline: number,
  observationFence: number,
) {
  const state = useSubagentStore.getState();
  return (
    (state.nodes[id]?.metadataRevision ?? 0) > baseline ||
    (state.identities[id]?.revision ?? -1) > baseline ||
    (nativeObservationFences.get(id) ?? 0) > observationFence
  );
}
export function confirmSubagentMetadata(
  threads: SubagentThread[],
  baseline = useSubagentStore.getState().revision,
  observationFence?: number,
) {
  if (observationFence === undefined) {
    // Omission means a current native metadata observation. Read responses
    // and historical replay always provide the fence captured before reading.
    for (const thread of threads)
      if (typeof thread?.id === "string")
        nativeObservationFences.set(thread.id, ++metadataObservationClock);
    observationFence = captureSubagentMetadataFence();
  }
  useSubagentStore.setState((state) => {
    const accepted = threads.filter(
      (thread) =>
        typeof thread?.id === "string" &&
        !hasNewerSubagentMetadata(thread.id, baseline, observationFence!),
    );
    const next = metadataChanges(state, accepted, baseline, observationFence);
    // A completed verify/read is a newer observation even when values match.
    // Keep this order outside UI state so old discovery cannot overwrite it.
    for (const thread of accepted)
      nativeObservationFences.set(thread.id, ++metadataObservationClock);
    return next.nodes === state.nodes && next.identities === state.identities
      ? state
      : next;
  });
}
const seenEvents = new WeakSet<object>();
const seenHistory = new WeakSet<readonly ServerNotification[]>();
/** Snapshots are immutable; unrelated session updates reuse the same array. */
export function observeSubagentHistory(events: readonly ServerNotification[]) {
  if (seenHistory.has(events)) return;
  seenHistory.add(events);
  for (const event of events) observeSubagents(event, true);
}
export function observeSubagents(
  event: ServerNotification,
  historical = false,
) {
  if (seenEvents.has(event)) return;
  seenEvents.add(event);
  const p = event.params as any;
  const state = useSubagentStore.getState(),
    revision = state.revision + 1;
  let nodes = state.nodes;
  const update = (
    id: string,
    parent: string,
    data: Partial<SubagentNode>,
    thread: any = {},
  ) => {
    const old = nodes[id];
    if (
      !validParentEdge(nodes, id, old?.verified ? old.parentId : parent) ||
      classifySubagentThread(state.identities[id]?.thread ?? { id }) === "main"
    )
      return;
    const next: SubagentNode = {
      ...old,
      ...data,
      unavailable: historical
        ? (old?.unavailable ?? true)
        : (old?.unavailable ?? false),
      parentId: old?.verified ? old.parentId : parent,
      revision: historical && old ? old.revision : revision,
      verified: data.verified ?? old?.verified ?? false,
      evidence: data.evidence ?? old?.evidence ?? "created",
      thread: boundedSubagentThread(
        historical && old?.verified
          ? { ...thread, ...old.thread, id }
          : { ...old?.thread, ...thread, id },
      ),
    };
    if (old && sameSubagentValue(old, { ...next, revision: old.revision }))
      return;
    nodes = {
      ...nodes,
      [id]: next,
    };
  };
  if (event.method === "thread/started") {
    if (typeof p.thread?.id !== "string") return;
    if (historical && state.identities[p.thread.id]) return;
    confirmSubagentMetadata(
      [
        {
          ...p.thread,
          ...(historical && p.thread.canAcceptDirectInput === true
            ? { canAcceptDirectInput: null }
            : {}),
        },
      ],
      undefined,
      historical ? captureSubagentMetadataFence() : undefined,
    );
    return;
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
        // Communication, waiting, resuming and closing are not creation evidence.
        if (item.tool !== "spawnAgent" && !nodes[id]) continue;
        const parent = nodes[id]?.parentId ?? item.senderThreadId ?? p.threadId;
        const status = item.agentsStates?.[id]?.status;
        update(
          id,
          parent,
          {
            ...(item.tool === "spawnAgent"
              ? {
                  createdInTurn: nodes[id]?.createdInTurn ?? p.turnId,
                  objective:
                    typeof item.prompt === "string"
                      ? ` ${item.prompt.slice(0, 1024)}`.slice(1)
                      : undefined,
                }
              : {}),
          },
          {
            ...(item.tool === "spawnAgent" && item.model
              ? { model: item.model }
              : {}),
            ...(item.tool === "spawnAgent" && item.reasoningEffort
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
      if (typeof id === "string" && (item.kind === "started" || nodes[id]))
        update(id, nodes[id]?.parentId ?? p.threadId, {
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
