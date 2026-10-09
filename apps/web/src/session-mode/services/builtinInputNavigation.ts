import { codexService } from "./codexService";
import { refreshClaudeHistory } from "./followedSessionAuxSync";
import { useCodexStore } from "@session/components/codex/stores";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  useAgentSettingsStore,
  type AgentType,
} from "@session/stores/useAgentSettingsStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  agentCardKey,
  selectedAgentCard,
  useAgentCenterStore,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";
import { useSessionSplitStore } from "@session/stores/useSessionSplitStore";
import { invalidateAcpSessionOperation } from "@session/components/acp/sessionOperations";

/** Synchronize an existing focus with its input target using read-only history. */
export function synchronizeBuiltinInputTarget(card: AgentCenterCard) {
  const cwd = card.worktreePath || card.cwd;
  if (cwd) useWorkspaceStore.getState().setCwd(cwd);
  if (card.kind === "codex") {
    void codexService.setCurrentThread(card.id).catch(() => {});
  } else {
    const cc = useCCStore.getState();
    cc.switchToSession(card.id);
    if (
      !cc.activeSessionIds.includes(card.id) &&
      !useCCStore.getState().sessionMessagesMap[card.id]?.length
    )
      void refreshClaudeHistory(card.id).catch(() => {});
  }
}

/** Explicit history entry adds focus; it never starts or resumes execution. */
export function openBuiltinInputTarget(card: AgentCenterCard) {
  invalidateAcpSessionOperation();
  useAcpStore.getState().setActive(false);
  useAgentSettingsStore.getState().setSelectedAgent(card.kind);
  useLayoutStore.getState().setActiveSidebarTab(card.kind);
  const tabs = useAgentCenterStore.getState();
  tabs.addAgentCard(card);
  tabs.setCurrentAgentCardId(card.id, card.kind);
  useSessionSplitStore.getState().focusKey(agentCardKey(card));
  synchronizeBuiltinInputTarget(card);
}

/** Provider choice is navigation; preferences alone never choose a sender. */
export function selectBuiltinInputTarget(kind: AgentType) {
  const tabs = useAgentCenterStore.getState(),
    current = selectedAgentCard(tabs);
  const remembered =
    kind === "codex"
      ? useCodexStore.getState().currentThreadId
      : useCCStore.getState().activeSessionId;
  const candidates = [
    ...tabs.cards,
    ...(tabs.detachedCard ? [tabs.detachedCard] : []),
  ].filter((c) => c.kind === kind);
  const target =
    current?.kind === kind
      ? current
      : (candidates.find((c) => c.id === remembered) ?? candidates[0]);
  invalidateAcpSessionOperation();
  useAcpStore.getState().setActive(false);
  useAgentSettingsStore.getState().setSelectedAgent(kind);
  useLayoutStore.getState().setActiveSidebarTab(kind);
  if (target) {
    useSessionSplitStore.getState().focusKey(agentCardKey(target));
    tabs.setCurrentAgentCardId(target.id, target.kind);
    synchronizeBuiltinInputTarget(target);
    return;
  }
  tabs.setCurrentAgentCardId(null);
  if (kind === "codex") {
    void codexService.setCurrentThread(null).catch(() => {});
  } else {
    const cc = useCCStore.getState();
    cc.saveCurrentSessionMessages();
    cc.setActiveSessionId(null);
    cc.setMessages([]);
    cc.setConnected(false);
    cc.setShowExamples(false);
    cc.setLoading(false);
  }
}
