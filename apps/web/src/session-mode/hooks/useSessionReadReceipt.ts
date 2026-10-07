import { useEffect, type RefObject } from "react";
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

/** Visible grid cards do not imply attention: only the selected conversation does. */
export function useSessionReadReceipt(
  kind: SessionKind,
  id: string | null,
  latest: RefObject<HTMLDivElement | null>,
) {
  const unread = useSessionAttentionStore((s) =>
    id ? latestUnread(s.receipts[sessionKey(kind, id)]) : null,
  );
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
    const marker = latest.current;
    if (!id || !unread || !marker || !active) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      if (
        !visible ||
        document.hidden ||
        !document.hasFocus() ||
        !isSessionModeActive() ||
        marker.closest("[hidden]")
      )
        return;
      timer = setTimeout(() => {
        if (
          visible &&
          !document.hidden &&
          document.hasFocus() &&
          isSessionModeActive() &&
          !marker.closest("[hidden]")
        )
          useSessionAttentionStore.getState().read(kind, id, unread);
      }, 250);
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
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("workbench-mode-changed", check);
    };
  }, [id, unread, kind, active, latest]);
}

export function useAttentionStorageSync() {
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "kanban.session.attention")
        void useSessionAttentionStore.persist.rehydrate();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
}
