import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCCStore } from "../stores/cc";
import { useCodexStore } from "../components/codex/stores";
import { openedSessions } from "./openedSessions";
import { followupService, useFollowupStore } from "./followupService";
import { ccGetSessionMessages } from "./apiAdapt/cc";
import { fromSdkMessages } from "../components/cc/utils/fromSdkMessages";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";
import { openEventStream } from "../lib/eventStream";
import type { CCMessage } from "../components/cc/types/messages";

export async function refreshClaudeHistory(id: string, signal?: AbortSignal) {
  const before = useCCStore.getState().sessionMessagesMap[id] ?? [];
  // Register before the first read, so the global bridge retains concurrent events.
  if (!useCCStore.getState().sessionMessagesMap[id])
    useCCStore.setState((s) => ({
      sessionMessagesMap: { ...s.sessionMessagesMap, [id]: [] },
    }));
  const raw = await enqueueSessionRead("history", `cc:${id}`, () =>
    readWithDeadline(
      (s) => ccGetSessionMessages(id, { signal: s, suppressToast: true }),
      10000,
      signal,
    ),
  );
  if (signal?.aborted) return;
  const history = fromSdkMessages(raw, id);
  useCCStore.setState((s) => {
    const current = s.sessionMessagesMap[id] ?? [];
    const baseline = new Set(before);
    const changed = new Map(
      current
        .filter((m) => !baseline.has(m))
        .map((m) => [(m as { uuid?: string }).uuid, m]),
    );
    const seen = new Set<string>();
    const merged: CCMessage[] = history.map((m) => {
      const uuid = (m as { uuid?: string }).uuid;
      if (uuid) seen.add(uuid);
      return uuid && changed.has(uuid) ? changed.get(uuid)! : m;
    });
    for (const message of current) {
      const uuid = (message as { uuid?: string }).uuid;
      if (
        (uuid && !seen.has(uuid)) ||
        (!uuid && !["user", "assistant"].includes(message.type))
      )
        merged.push(message);
    }
    if (JSON.stringify(merged) === JSON.stringify(current)) return s;
    return {
      sessionMessagesMap: { ...s.sessionMessagesMap, [id]: merged },
      ...(s.activeSessionId === id ? { messages: merged } : {}),
    };
  });
}

/** Queue snapshots and Claude history follow display membership, not mounted composers. */
export function startFollowedSessionAuxSync() {
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
          : refreshClaudeHistory(card.id, controller.signal);
      void operation
        .catch(() => {})
        .finally(() => {
          checked.set(key, Date.now());
          busy.delete(key);
          controllers.delete(key);
        });
    }
  }
  const wake = () => tick();
  const stopMembers = useAgentCenterStore.subscribe((next, prev) => {
    if (next.cards !== prev.cards || next.detachedCard !== prev.detachedCard)
      tick();
  });
  const close = openEventStream({
    agents: ["cc", "codex"],
    onOpen: () => tick(),
    onResync: () => tick(true),
    onEvent: () => {},
  });
  const timer = setInterval(wake, 1000);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    stopMembers();
    close();
    for (const c of controllers.values()) c.abort();
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
