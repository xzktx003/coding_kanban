import { captureHistorySourceScope } from "../components/history/historySourceScope";
import { confirmProviderHistoryRows } from "./providerHistorySourceConfirmation";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCCStore } from "../stores/cc";
import { useCodexStore } from "../components/codex/stores";
import { openedSessions } from "./openedSessions";
import { followupService, useFollowupStore } from "./followupService";
import { ccReadSessionTranscript } from "./apiAdapt/cc";
import { fromSdkMessages } from "../components/cc/utils/fromSdkMessages";
import {
  enqueueSessionRead,
  promoteSessionRead,
  readWithDeadline,
  type SessionReadPriority,
} from "./sessionReadQueue";
import { openEventStream } from "../lib/eventStream";
import type { CCMessage } from "../components/cc/types/messages";
import { shareClaudeHistory } from "./claudeHistorySharing";
import { historyReadConsumer } from "./sharedHistoryRead";
import { admitProviderTranscriptRows } from "./providerTranscriptBudget";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  providerTranscriptGeneration,
  canPublishProviderTranscript,
  isProviderTranscriptDormant,
  updateProviderTranscript,
  useProviderTranscriptStore,
  registerProviderWarmReader,
} from "./sessionProviderTranscriptState";
import { authHeaders, buildUrl } from "../hooks/runtime";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
  startCodexOperationScopeSync,
} from "./codexOperationScope";
import {
  currentAcpTranscriptTarget,
  acpTranscriptOwner,
  refreshAcpTranscript,
} from "./acpTranscriptRead";
import { startAcpRuntimeOwners } from "./acpRuntimeOwners";
import { startAcpConnectionRecovery } from "./acpConnectionRecovery";
import { refreshClaudeConnection } from "./claudeConnectionRecovery";

const claudeReads = new Map<
  string,
  {
    key: string;
    consume: (signal?: AbortSignal) => Promise<void>;
    controller: AbortController;
  }
>();
const serviceStops = new Set<() => void>();
import.meta.hot?.dispose(() => {
  for (const stop of [...serviceStops]) stop();
  for (const read of claudeReads.values()) read.controller.abort();
  claudeReads.clear();
});
export async function refreshClaudeHistory(
  id: string,
  signal?: AbortSignal,
  priority: SessionReadPriority = "interactive",
  cursor?: string,
): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  const owner = providerTranscriptKey("cc", id);
  trackProviderTranscript(owner, "cc", id);
  if (isProviderTranscriptDormant(owner) && priority === "background") return;
  const endpoint = buildUrl("/api/cc/session-messages");
  const key = JSON.stringify([endpoint, owner, cursor ?? null]);
  for (;;) {
    const pending = claudeReads.get(id);
    if (!pending) break;
    if (priority === "interactive") promoteSessionRead("history", pending.key);
    if (pending.key === key) return pending.consume(signal);
    await pending.consume(signal).catch((error) => {
      if (signal?.aborted) throw error;
    });
  }
  const controller = new AbortController();
  const operation = loadClaudeHistory(
    id,
    owner,
    controller.signal,
    priority,
    key,
    endpoint,
    cursor,
  );
  const detach = () => {
    if (claudeReads.get(id)?.consume === consume) claudeReads.delete(id);
  };
  const consume = historyReadConsumer(operation, controller, detach);
  claudeReads.set(id, { key, consume, controller });
  void operation.then(detach, detach);
  return consume(signal);
}
export function cancelClaudeHistoryRead(id: string) {
  claudeReads.get(id)?.controller.abort();
  claudeReads.delete(id);
}
async function loadClaudeHistory(
  id: string,
  owner: string,
  signal: AbortSignal,
  priority: SessionReadPriority,
  key: string,
  endpoint: string,
  cursor?: string,
) {
  const sourceScope = captureHistorySourceScope("/api/cc/session-messages");
  const scope = captureCodexOperationScope(),
    authorization = authHeaders().Authorization,
    stopScope = startCodexOperationScopeSync();
  const scopeCurrent = () =>
    isCodexOperationScopeCurrent(scope) &&
    authorization === authHeaders().Authorization;
  const generation = providerTranscriptGeneration(owner);
  const before = new WeakSet(
    useCCStore.getState().sessionMessagesMap[id] ?? [],
  );
  if (!useCCStore.getState().sessionMessagesMap[id])
    useCCStore.setState((s) => ({
      sessionMessagesMap: { ...s.sessionMessagesMap, [id]: [] },
    }));
  updateProviderTranscript(owner, { loading: true, error: null });
  try {
    const page = await enqueueSessionRead(
      "history",
      key,
      () =>
        readWithDeadline(
          (s) =>
            ccReadSessionTranscript(id, {
              signal: s,
              suppressToast: true,
              ...(cursor ? { cursor } : {}),
            }),
          10_000,
          signal,
        ),
      signal,
      priority,
    );
    if (
      signal.aborted ||
      !scopeCurrent() ||
      endpoint !== buildUrl("/api/cc/session-messages") ||
      !canPublishProviderTranscript(owner, generation)
    )
      return;
    if (
      page.projection !== "cc-messages" ||
      !Array.isArray(page.data) ||
      typeof page.revision !== "string" ||
      (page.nextCursor !== null && typeof page.nextCursor !== "string")
    )
      throw new Error("Claude 近期历史协议不可用，请更新会话服务后重试。");
    const history = fromSdkMessages(page.data, id);
    useCCStore.setState((s) => {
      if (!scopeCurrent() || !canPublishProviderTranscript(owner, generation))
        return s;
      const current = s.sessionMessagesMap[id] ?? [];
      const changed = new Map(
        current
          .filter((m) => !before.has(m))
          .map((m) => [(m as { uuid?: string }).uuid, m]),
      );
      const seen = new Set(
        history.map((m) => (m as { uuid?: string }).uuid).filter(Boolean),
      );
      const incoming = history.map((m) => {
        const uuid = (m as { uuid?: string }).uuid;
        return uuid && changed.has(uuid) ? changed.get(uuid)! : m;
      });
      const absent = current.filter(
        (m) => !seen.has((m as { uuid?: string }).uuid),
      );
      const older = absent.filter(
        (m) => before.has(m) && m.type !== "permission_request",
      );
      const live = absent.filter(
        (m) => !before.has(m) || m.type === "permission_request",
      );
      const merged = cursor
        ? [...incoming, ...absent]
        : [...older, ...incoming, ...live];
      const admitted = admitProviderTranscriptRows(
        shareClaudeHistory(current, merged),
        {
          edge: cursor ? "earlier" : "latest",
          pinned: (m) => m.type === "permission_request" && !m.resolved,
        },
      );
      const shared = admitted.rows;
      const incomingRows = new Set(incoming);
      const confirmed = new Map(
        history
          .filter((row) => incomingRows.has(row))
          .flatMap((row) =>
            "uuid" in row && typeof row.uuid === "string"
              ? [[row.uuid, row] as const]
              : [],
          ),
      );
      confirmProviderHistoryRows(
        shared.flatMap((row) => {
          if (!("uuid" in row) || typeof row.uuid !== "string") return [];
          const item = confirmed.get(row.uuid);
          const itemId =
            item && "historyDetail" in item
              ? item.historyDetail?.itemId
              : undefined;
          return itemId &&
            "historyDetail" in row &&
            row.historyDetail?.itemId === itemId
            ? [{ row, provider: "cc" as const, sourceId: id, itemId, owner }]
            : [];
        }),
        sourceScope,
        cursor,
      );
      updateProviderTranscript(owner, {
        restoreNeeded: false,
        loading: false,
        nextCursor: page.nextCursor,
        revision: page.revision,
        truncated: page.truncated || admitted.trimmed,
        error: null,
      });
      if (shared === current) return s;
      return {
        sessionMessagesMap: { ...s.sessionMessagesMap, [id]: shared },
        ...(s.activeSessionId === id ? { messages: shared } : {}),
      };
    });
  } catch (error) {
    if (
      !signal.aborted &&
      scopeCurrent() &&
      canPublishProviderTranscript(owner, generation)
    )
      updateProviderTranscript(owner, {
        error: error instanceof Error ? error.message : String(error),
      });
    throw error;
  } finally {
    stopScope();
    if (canPublishProviderTranscript(owner, generation))
      updateProviderTranscript(owner, { loading: false });
  }
}
async function checkClaudeHistory(
  id: string,
  signal: AbortSignal,
  force: boolean,
  priority: SessionReadPriority,
) {
  const owner = providerTranscriptKey("cc", id);
  trackProviderTranscript(owner, "cc", id);
  const entry = useProviderTranscriptStore.getState().entries[owner];
  if (!entry.dormant && (force || entry.restoreNeeded || !entry.revision))
    return refreshClaudeHistory(id, signal, priority);
  const generation = providerTranscriptGeneration(owner);
  const endpoint = buildUrl("/api/cc/session-messages");
  const scope = captureCodexOperationScope(),
    authorization = authHeaders().Authorization,
    stopScope = startCodexOperationScopeSync();
  // A metadata notice is safe for a dormant body, but an old owner/generation
  // must never publish after cancellation, recovery or a runtime change.
  const current = () =>
    !signal.aborted &&
    isCodexOperationScopeCurrent(scope) &&
    authorization === authHeaders().Authorization &&
    generation === providerTranscriptGeneration(owner) &&
    endpoint === buildUrl("/api/cc/session-messages");
  try {
    const page = await enqueueSessionRead(
      "status",
      `cc-revision:${id}`,
      () =>
        readWithDeadline(
          (s) =>
            ccReadSessionTranscript(id, {
              signal: s,
              suppressToast: true,
              metadataOnly: true,
            }),
          10_000,
          signal,
        ),
      signal,
      priority,
    );
    if (!current()) return;
    if (page.projection !== "cc-messages" || typeof page.revision !== "string")
      throw new Error("Claude 近期历史协议不可用，请更新会话服务后重试。");
    updateProviderTranscript(owner, { error: null });
    if (page.revision !== entry.revision) {
      if (isProviderTranscriptDormant(owner))
        updateProviderTranscript(owner, { restoreNeeded: true });
      else return refreshClaudeHistory(id, signal, priority);
    }
  } catch (error) {
    if (current())
      updateProviderTranscript(owner, {
        error: error instanceof Error ? error.message : String(error),
      });
    throw error;
  } finally {
    stopScope();
  }
}

/** Queue snapshots and Claude history follow display membership, not mounted composers. */
export function startFollowedSessionAuxSync() {
  const stopAcpOwners = startAcpRuntimeOwners();
  const stopAcpRecovery = startAcpConnectionRecovery();
  let stopped = false;
  const checked = new Map<string, number>(),
    busy = new Set<string>(),
    controllers = new Map<string, AbortController>();
  function tick(force = false) {
    if (stopped || document.hidden) return;
    const members = openedSessions(),
      keys = new Set(members.map((c) => `${c.kind}:${c.id}`));
    for (const [key, controller] of controllers)
      if (!keys.has(key)) controller.abort();
    for (const card of members) {
      const key = `${card.kind}:${card.id}`;
      const queue = useFollowupStore.getState().threads[card.id];
      const codex = useCodexStore.getState();
      const codexBusy =
        !queue ||
        queue.awaitingTurnId ||
        queue.stopTurnId ||
        queue.review?.status === "inProgress" ||
        queue.items.some((item) =>
          ["queued", "sending", "uncertain"].includes(item.status),
        ) ||
        codex.threadStatusMap[card.id]?.type === "active" ||
        codex.turnTimingMap[card.id]?.status === "inProgress";
      const interval =
        card.kind === "codex"
          ? codexBusy
            ? 5000
            : 30000
          : useCCStore.getState().sessionLoadingMap[card.id]
            ? 5000
            : 30000;
      if (
        busy.has(key) ||
        (!force && Date.now() - (checked.get(key) ?? -Infinity) < interval)
      )
        continue;
      busy.add(key);
      const controller = new AbortController();
      controllers.set(key, controller);
      const operation =
        card.kind === "codex"
          ? followupService.load(card.id, { signal: controller.signal })
          : Promise.allSettled([
              refreshClaudeConnection(
                card.id,
                card.worktreePath ?? card.cwd ?? "",
                controller.signal,
              ),
              checkClaudeHistory(
                card.id,
                controller.signal,
                force,
                useProviderTranscriptStore.getState().entries[
                  providerTranscriptKey("cc", card.id)
                ]?.consumers ||
                  (useAgentCenterStore.getState().currentAgentCardKind ===
                    "cc" &&
                    useAgentCenterStore.getState().currentAgentCardId ===
                      card.id)
                  ? "interactive"
                  : "background",
              ),
            ]);
      void operation
        .catch(() => {})
        .finally(() => {
          if (controllers.get(key) !== controller) return;
          checked.set(key, Date.now());
          busy.delete(key);
          controllers.delete(key);
        });
    }
  }
  const wake = () => tick();
  const runtimeChanged = () => {
    for (const controller of controllers.values()) controller.abort();
    checked.clear();
    busy.clear();
    controllers.clear();
    tick(true);
  };
  const stopMembers = useAgentCenterStore.subscribe((next, prev) => {
    if (next.cards !== prev.cards || next.detachedCard !== prev.detachedCard)
      tick();
  });
  const stopWarm = registerProviderWarmReader("cc", (_owner, id) => {
    if (
      !stopped &&
      openedSessions().some((card) => card.kind === "cc" && card.id === id)
    )
      void refreshClaudeHistory(id, undefined, "background").catch(() => {});
  });
  const stopAcpWarm = registerProviderWarmReader("acp", (owner) => {
    const target = currentAcpTranscriptTarget();
    if (!stopped && target && acpTranscriptOwner(target) === owner)
      void refreshAcpTranscript(target, undefined, "background").catch(
        () => {},
      );
  });
  const close = openEventStream({
    agents: ["cc", "codex"],
    onOpen: () => tick(),
    onResync: () => tick(true),
    onEvent: () => {},
  });
  const timer = setInterval(wake, 1000);
  window.addEventListener("online", wake);
  window.addEventListener("session-runtime-restarted", runtimeChanged);
  document.addEventListener("visibilitychange", wake);
  tick();
  const stop = () => {
    stopped = true;
    stopAcpRecovery();
    stopAcpOwners();
    clearInterval(timer);
    stopMembers();
    stopWarm();
    stopAcpWarm();
    close();
    for (const c of controllers.values()) c.abort();
    window.removeEventListener("online", wake);
    window.removeEventListener("session-runtime-restarted", runtimeChanged);
    document.removeEventListener("visibilitychange", wake);
    serviceStops.delete(stop);
  };
  serviceStops.add(stop);
  return stop;
}
