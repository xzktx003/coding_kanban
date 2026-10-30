import { useEffect, useRef, useState, type RefObject } from "react";
import {
  useSessionAttentionStore,
  latestUnread,
  sessionKey,
  type SessionKind,
} from "../stores/useSessionAttentionStore";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useLayoutStore } from "../stores/useLayoutStore";
import { useAcpStore } from "../stores/useAcpStore";
import { isSessionModeActive } from "../session-dom";
import {
  prepareVisibleSessionRead,
  withVisibleSessionReadProof,
  isSharedSessionManagementActive,
  retrySessionManagementSync,
} from "../services/sessionManagementClient";

/** Visible grid cards do not imply attention: only the selected conversation does. */
export function useSessionReadReceipt(
  kind: SessionKind,
  id: string | null,
  latest: RefObject<HTMLDivElement | null>,
) {
  const unread = useSessionAttentionStore((s) =>
    id ? latestUnread(s.receipts[sessionKey(kind, id)]) : null,
  );
  const manualRevision = useSessionAttentionStore((s) =>
    id ? (s.receipts[sessionKey(kind, id)]?.manualUnreadRevision ?? 0) : 0,
  );
  const attempted = useRef<string | null>(null);
  const manualCheckpoint = useRef({ kind, id, revision: manualRevision });
  const [readingEntry, setReadingEntry] = useState(0);
  const view = useLayoutStore((s) => s.view);
  const mode = useAgentCenterStore((s) => s.cardsViewMode);
  const selected = useAgentCenterStore((s) => s.currentAgentCardId);
  const selectedKind = useAgentCenterStore((s) => s.currentAgentCardKind);
  const agent = useAgentSettingsStore((s) => s.selectedAgent);
  const acp = useAcpStore((s) => s.active);
  const active =
    view === "agent" &&
    (mode !== "solo"
      ? !acp && selected === id && (!selectedKind || selectedKind === kind)
      : kind === "acp"
        ? acp
        : !acp && agent === kind);
  useEffect(() => {
    attempted.current = null;
  }, [id, kind, active]);
  useEffect(() => {
    const previous = manualCheckpoint.current;
    if (
      previous.kind === kind &&
      previous.id === id &&
      previous.revision !== manualRevision &&
      unread
    )
      attempted.current = `${kind}:${id}:${unread}`;
    manualCheckpoint.current = { kind, id, revision: manualRevision };
  }, [kind, id, manualRevision, unread]);
  useEffect(() => {
    const enter = () => {
      if (document.hidden || !document.hasFocus() || !isSessionModeActive())
        return;
      attempted.current = null;
      setReadingEntry((value) => value + 1);
    };
    window.addEventListener("focus", enter);
    document.addEventListener("visibilitychange", enter);
    window.addEventListener("workbench-mode-changed", enter);
    return () => {
      window.removeEventListener("focus", enter);
      document.removeEventListener("visibilitychange", enter);
      window.removeEventListener("workbench-mode-changed", enter);
    };
  }, []);
  useEffect(() => {
    const marker = latest.current;
    if (!id || !unread || !marker || !active) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observation: AbortController | undefined;
    const observed = `${kind}:${id}:${unread}`;
    const cancel = () => {
      clearTimeout(timer);
      observation?.abort();
      observation = undefined;
    };
    const check = () => {
      if (
        !visible ||
        document.hidden ||
        !document.hasFocus() ||
        !isSessionModeActive() ||
        marker.closest("[hidden]")
      ) {
        cancel();
        return;
      }
      if (attempted.current === observed || observation) return;
      const controller = new AbortController();
      observation = controller;
      // Capture native revision before starting the visibility dwell. Never
      // fetch a newer revision after a CAS conflict or manual-unread update.
      void (
        kind === "codex"
          ? prepareVisibleSessionRead(id, unread, controller.signal)
          : Promise.resolve(undefined)
      )
        .then((proof) => {
          if (controller.signal.aborted) return;
          timer = setTimeout(() => {
            if (
              !controller.signal.aborted &&
              visible &&
              !document.hidden &&
              document.hasFocus() &&
              isSessionModeActive() &&
              !marker.closest("[hidden]")
            ) {
              attempted.current = observed;
              withVisibleSessionReadProof(kind, id, proof, () =>
                useSessionAttentionStore
                  .getState()
                  .read(kind, id, unread, manualRevision),
              );
            }
          }, 250);
        })
        .catch(() => {
          if (!controller.signal.aborted) attempted.current = observed;
        });
    };
    const nativeChanged = (event: Event) => {
      if ((event as CustomEvent<{ threadId?: string }>).detail?.threadId !== id)
        return;
      attempted.current = observed;
      cancel();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        check();
      },
      { threshold: 1 },
    );
    observer.observe(marker);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("workbench-mode-changed", check);
    window.addEventListener("session-native-read-state-changed", nativeChanged);
    return () => {
      cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("workbench-mode-changed", check);
      window.removeEventListener(
        "session-native-read-state-changed",
        nativeChanged,
      );
    };
  }, [id, unread, kind, active, latest, manualRevision, readingEntry]);
}

export function useAttentionStorageSync() {
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "kanban.session.attention") {
        if (isSharedSessionManagementActive()) retrySessionManagementSync();
        else void useSessionAttentionStore.persist.rehydrate();
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
}
