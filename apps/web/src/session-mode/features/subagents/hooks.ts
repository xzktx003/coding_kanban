import { useEffect, useMemo, useRef } from "react";
import { notifyDesktop } from "@session/lib/notify";
import { toast } from "@session/components/ui/use-toast";
import { pendingFamilies, pendingIdentity } from "./pending";
import { useShallow } from "zustand/react/shallow";
import type { ServerNotification } from "@session/bindings";
import {
  useCodexStore,
  useApprovalStore,
  useRequestUserInputStore,
  usePermissionsStore,
  useElicitationStore,
} from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { openEventStream } from "@session/lib/eventStream";
import { isSessionModeActive } from "@session/session-dom";
import { usePairingStore } from "@session/stores/usePairingStore";
import { childState, descendants, inParentTurn } from "./model";
import { observeSubagentHistory, useSubagentStore } from "./store";
import { subagentService, resetSubagentRuntime } from "./service";
import { subagentScope, subagentStorageKey } from "./scope";
const EMPTY_EVENTS: readonly ServerNotification[] = [];
export function useSubagentFamily(root: string | null) {
  const rows = useSubagentStore(
    useShallow((s) => (root ? descendants(s.nodes, root) : [])),
  );
  const familyState = useSubagentStore(
    useShallow((s) => ({
      family: root ? s.families[root] : undefined,
      selection: root ? s.selection[root] : null,
      stopResults: root ? s.stopResults[root] : undefined,
      revision: s.revision,
      runtimeEpoch: s.runtimeEpoch,
      scope: s.scope,
      apply: s.apply,
    })),
  );
  const scopedNodes = Object.fromEntries(
    rows.map((node) => [node.thread.id, node]),
  );
  const familyIds = root ? [root, ...rows.map((node) => node.thread.id)] : [];
  const codexTiming = useCodexStore(
    useShallow((s) => familyIds.map((id) => s.turnTimingMap[id])),
  );
  const codexStatuses = useCodexStore(
    useShallow((s) => familyIds.map((id) => s.threadStatusMap[id])),
  );
  const codexThreads = useCodexStore(
    useShallow((s) =>
      familyIds.map((id) => s.threads.find((thread) => thread.id === id)),
    ),
  );
  const approvals = useApprovalStore((s) => s.pendingApprovals),
    questions = useRequestUserInputStore((s) => s.pendingRequests),
    permissions = usePermissionsStore((s) => s.pendingRequests),
    elicitations = useElicitationStore((s) => s.pendingRequests);
  const requests = [
    ...approvals,
    ...questions,
    ...permissions,
    ...elicitations,
  ];
  const timingById = Object.fromEntries(
    familyIds.map((id, index) => [id, codexTiming[index]]),
  );
  const statusById = Object.fromEntries(
    familyIds.map((id, index) => [id, codexStatuses[index]]),
  );
  const threadById = new Map(
    familyIds.map((id, index) => [id, codexThreads[index]]),
  );
  const turn = root
    ? (timingById[root]?.turnId ?? threadById.get(root)?.turns?.at(-1)?.id)
    : undefined;
  return {
    nodes: scopedNodes,
    families: root && familyState.family ? { [root]: familyState.family } : {},
    selection: root ? { [root]: familyState.selection } : {},
    stopResults:
      root && familyState.stopResults
        ? { [root]: familyState.stopResults }
        : {},
    revision: familyState.revision,
    runtimeEpoch: familyState.runtimeEpoch,
    scope: familyState.scope,
    apply: familyState.apply,
    turn,
    family: familyState.family,
    rows: rows.map((node) => {
      const pending = new Set(
        requests
          .filter((r) => r.threadId === node.thread.id)
          .map(pendingIdentity),
      ).size;
      const live = {
        ...node,
        thread: {
          ...node.thread,
          status: statusById[node.thread.id] ?? node.thread.status,
        },
      };
      const timing = timingById[node.thread.id];
      return {
        node: live,
        pending,
        state: childState(live, timing, pending),
        turnId:
          timing?.status === "inProgress"
            ? timing.turnId
            : node.thread.turns?.at(-1)?.status === "inProgress"
              ? node.thread.turns.at(-1)!.id
              : undefined,
        current: !!root && inParentTurn(scopedNodes, root, node, turn),
      };
    }),
  };
}
/** Passive observation follows the existing cards; it never opens a writer or adds a card. */
export function useSubagentFamilySync() {
  const host = usePairingStore((s) => s.selectedHost),
    scope = subagentScope();
  const notified = useRef(new Set<string>());
  const nodes = useSubagentStore((s) => s.nodes);
  const approvals = useApprovalStore((s) => s.pendingApprovals),
    questions = useRequestUserInputStore((s) => s.pendingRequests),
    permissions = usePermissionsStore((s) => s.pendingRequests),
    elicitations = useElicitationStore((s) => s.pendingRequests);
  useEffect(() => {
    if (useSubagentStore.getState().scope !== scope) {
      // Rehydrate before writing anything under the new host's storage key.
      useSubagentStore.persist.setOptions({ name: subagentStorageKey() });
      void useSubagentStore.persist.rehydrate();
    }
    notified.current.clear();
    const reset = () => {
      notified.current.clear();
      resetSubagentRuntime();
    };
    window.addEventListener("session-runtime-restarted", reset);
    return () => {
      resetSubagentRuntime();
      window.removeEventListener("session-runtime-restarted", reset);
    };
  }, [scope, host]);
  const cards = useAgentCenterStore((s) => s.cards);
  const roots = cards
    .filter((c) => c.kind === "codex")
    .map((c) => c.id)
    .sort()
    .join("\n");
  const historyIds = useMemo(
    () =>
      [
        ...new Set([
          ...roots.split("\n").filter(Boolean),
          ...roots
            .split("\n")
            .filter(Boolean)
            .flatMap((root) =>
              descendants(nodes, root).map((node) => node.thread.id),
            ),
        ]),
      ].sort(),
    [nodes, roots],
  );
  const historyEvents = useCodexStore(
    useShallow((s) => historyIds.map((id) => s.events[id] ?? EMPTY_EVENTS)),
  );
  useEffect(() => {
    for (const entries of historyEvents) observeSubagentHistory(entries);
  }, [historyEvents]);
  useEffect(() => {
    const groups = pendingFamilies(nodes, roots.split("\n"), [
      ...approvals,
      ...questions,
      ...permissions,
      ...elicitations,
    ]);
    const timer = setTimeout(() => {
      for (const group of groups) {
        const fresh = group.requests.filter(
          (r) => !notified.current.has(pendingIdentity(r)),
        );
        if (!fresh.length) continue;
        for (const request of fresh)
          notified.current.add(pendingIdentity(request));
        if (!document.hidden && document.hasFocus() && isSessionModeActive())
          continue;
        const parent = useCodexStore
          .getState()
          .threads.find((t) => t.id === group.root);
        const title = `Codex 子任务待处理 · ${parent?.name ?? group.root.slice(0, 8)}`;
        const body = `${group.requests.length} 项待处理 · ${[...new Set(group.requests.map((r) => nodes[r.threadId]?.thread.agentNickname ?? r.threadId.slice(0, 8)))].join("、")}`;
        void notifyDesktop(title, body, () =>
          toast.info(title, { description: body }),
        );
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [nodes, roots, approvals, questions, permissions, elicitations, scope]);
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      running = false;
    const refresh = async () => {
      if (running || disposed || !isSessionModeActive() || document.hidden)
        return;
      running = true;
      try {
        for (const root of roots.split("\n").filter(Boolean)) {
          if (disposed) break;
          await subagentService.refresh(root);
        }
      } finally {
        running = false;
      }
    };
    const tick = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(tick, 15000);
    };
    void tick();
    const stop = openEventStream({
      agents: ["codex"],
      onOpen: () => {
        void refresh();
      },
      onResync: () => {
        void refresh();
      },
      onEvent: () => {},
    });
    const wake = () => {
      void refresh();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      stop();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [roots, scope]);
}
