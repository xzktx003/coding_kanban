import type { ThreadGoal } from "@session/bindings/v2";
import { useEffect } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { codexService } from "@session/services/codexService";
import { openEventStream } from "@session/lib/eventStream";
import { useAgentInteractionVisible } from "@session/session-dom";

/** Full ThreadGoal for a given thread (or currentThreadId), if one is set. */
export function useThreadGoal(
  threadId?: string | null,
): ThreadGoal | undefined {
  const selectedId = useCodexStore((state) =>
    threadId !== undefined ? threadId : state.currentThreadId,
  );
  const visible = useAgentInteractionVisible();
  const accountScope = useCodexStore((state) =>
    JSON.stringify([
      state.accountNamespace,
      state.hasAccount,
      state.account?.type,
    ]),
  );
  const scopeVersion = useCodexStore((state) => state.goalScopeVersion);
  useEffect(() => {
    if (!selectedId || !visible) return;
    let active = true;
    let opened = false;
    let lastWake = -Infinity;
    const refresh = () => {
      if (!active || document.visibilityState === "hidden") return;
      void codexService
        .threadGoalGet({ threadId: selectedId })
        .catch(() => undefined);
    };
    refresh();
    const close = openEventStream({
      agents: ["codex"],
      onEvent: () => {},
      onOpen: () => {
        if (opened) refresh();
        opened = true;
      },
      onResync: refresh,
    });
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastWake < 1000) return;
      lastWake = Date.now();
      refresh();
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      active = false;
      close();
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [selectedId, visible, accountScope, scopeVersion]);
  return useCodexStore((state) =>
    selectedId ? state.goalMap[selectedId] : undefined,
  );
}
