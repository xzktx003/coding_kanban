import {
  splitGroups,
  useSessionSplitStore,
} from "@session/stores/useSessionSplitStore";
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
import { rememberClosedTab } from "@session/stores/closedSessionTabs";
import { registerSessionTabSelect } from "@session/stores/sessionTabSelect";
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
        const stored = tabs.cards.find(
          (item) => agentCardKey(item) === agentCardKey(card),
        );
        rememberClosedTab(stored ?? card);
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
  useEffect(() => registerSessionTabSelect(selectTab), [selectTab]);
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
      if (tabs.newChatIntent) {
        restored.current = true;
        return;
      }
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
        return;
      }

      // A reload can restore the shared tab membership and split layout before
      // the per-window input target.  In that window the layout still has an
      // explicit selected card, while currentAgentCardId is temporarily null;
      // treating that as a new chat leaves the centre on the welcome screen
      // even though the tab strip contains the user's conversations.  Recover
      // the selected card once during startup.  New-agent actions run after
      // this hook has settled, so an intentional empty composer remains empty.
      if (tabs.sharedTabsInitialized) {
        const groups = splitGroups(useSessionSplitStore.getState().tree);
        const activeGroup =
          groups.find(
            (group) =>
              group.id === useSessionSplitStore.getState().activeGroupId,
          ) ?? groups[0];
        const layoutKey = activeGroup?.selected;
        const layoutSelected = layoutKey
          ? tabs.cards.find((card) => agentCardKey(card) === layoutKey)
          : undefined;
        if (layoutSelected) {
          restored.current = true;
          void selectTab(layoutSelected);
          return;
        }
        // A persisted empty group is an intentional new-chat pane. Preserve it
        // even when other tabs are followed in another group. For a group whose
        // membership has not been reconciled yet, keep listening: the split
        // store will publish the selected key once the shared cards arrive.
        if (activeGroup?.keepEmpty && !activeGroup.keys.length) {
          restored.current = true;
          return;
        }
        if (!activeGroup?.keys.length) return;
        // A malformed persisted selection should not strand the user on the
        // welcome screen when the group does contain cards. Pick its first
        // exact key and let normal selection verify the history owner.
        const first = activeGroup.keys
          .map((key) => tabs.cards.find((card) => agentCardKey(card) === key))
          .find((card): card is AgentCenterCard => Boolean(card));
        if (first) {
          restored.current = true;
          void selectTab(first);
          return;
        }
        // The persisted store can briefly report `sharedTabsInitialized` before
        // the first server snapshot has populated cards. Keep listening in that
        // transient empty state; otherwise the later snapshot cannot restore
        // the layout selection and the centre remains on the welcome screen.
        if (tabs.cards.length > 0) restored.current = true;
      }
    };
    const unsubscribe = useAgentCenterStore.subscribe(restore);
    const unsubscribeLayout = useSessionSplitStore.subscribe(restore);
    restore();
    return () => {
      unsubscribe();
      unsubscribeLayout();
    };
  }, [selectTab]);
}
