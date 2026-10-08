import { useSessionSplitStore } from "@session/stores/useSessionSplitStore";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCodexStore } from "@session/components/codex/stores";
import { codexService } from "@session/services/codexService";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  agentCardKey,
  selectedAgentCard,
  useAgentCenterStore,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useCCSessionManager } from "./useCCSessionManager";

/** Tab/card controls only navigate. Closing never interrupts or deletes resources. */
export function useSessionTabActions() {
  const { handleSessionSelect } = useCCSessionManager();
  const selectTab = useCallback(
    async (card: AgentCenterCard) => {
      const tabs = useAgentCenterStore.getState();
      if (
        !tabs.cards.some((c) => agentCardKey(c) === agentCardKey(card)) &&
        (!tabs.detachedCard ||
          agentCardKey(tabs.detachedCard) !== agentCardKey(card))
      )
        return;
      useSessionSplitStore.getState().focusKey(agentCardKey(card));
      tabs.setCurrentAgentCardId(card.id, card.kind);
      useAcpStore.getState().setActive(false);
      useAgentSettingsStore.getState().setSelectedAgent(card.kind);
      if (card.cwd) useWorkspaceStore.getState().setCwd(card.cwd);
      try {
        if (card.kind === "codex") await codexService.setCurrentThread(card.id);
        else await handleSessionSelect(card.id, card.cwd ?? undefined);
      } catch (error) {
        toast.error("会话加载失败，可重新点击标签重试", {
          description: String(error),
        });
      }
    },
    [handleSessionSelect],
  );

  const closeTab = useCallback(
    async (card: AgentCenterCard) => {
      const tabs = useAgentCenterStore.getState();
      const active = selectedAgentCard(tabs);
      const wasActive = active && agentCardKey(active) === agentCardKey(card);
      try {
        tabs.removeCard(card);
      } catch (error) {
        toast.error("关闭标签未能保存，请检查浏览器存储后重试", {
          description: String(error),
        });
        return;
      }
      if (!wasActive) return;
      const next = selectedAgentCard(useAgentCenterStore.getState());
      if (next) await selectTab(next);
      else {
        await codexService.setCurrentThread(null);
        const cc = useCCStore.getState();
        cc.saveCurrentSessionMessages();
        cc.setActiveSessionId(null);
        cc.setMessages([]);
        cc.setLoading(false);
        cc.setConnected(false);
      }
    },
    [selectTab],
  );
  return { selectTab, closeTab };
}

/** Restore once, never follow backend activity back into the user's tab set. */
export function useRestoreSessionTabs() {
  const restored = useRef(false);
  const { selectTab } = useSessionTabActions();
  useEffect(() => {
    const restore = () => {
      if (restored.current) return;
      if (useAcpStore.getState().active) {
        restored.current = true;
        return;
      }
      const tabs = useAgentCenterStore.getState();
      const kind = useAgentSettingsStore.getState().selectedAgent;
      const codex = useCodexStore.getState();
      const currentId =
        kind === "cc"
          ? useCCStore.getState().activeSessionId
          : codex.currentThreadId;
      // A selection made while shared membership was loading always wins.
      if (currentId) {
        restored.current = true;
        const existing = tabs.cards.find(
          (c) => c.id === currentId && c.kind === kind,
        );
        if (existing) {
          tabs.setCurrentAgentCardId(existing.id, existing.kind);
          return;
        }
        if (tabs.sharedTabsInitialized) return;
        const thread =
          kind === "codex"
            ? codex.threads.find((t) => t.id === currentId)
            : undefined;
        tabs.addAgentCard({
          kind,
          id: currentId,
          cwd: thread?.cwd ?? useWorkspaceStore.getState().cwd,
          preview: thread?.name ?? thread?.preview,
        });
        return;
      }
      const saved = selectedAgentCard(tabs);
      if (saved) {
        restored.current = true;
        void selectTab(saved);
      } else if (tabs.sharedTabsInitialized && !tabs.currentAgentCardId)
        restored.current = true;
    };
    const unsubscribe = useAgentCenterStore.subscribe(restore);
    restore();
    return unsubscribe;
  }, [selectTab]);
}
