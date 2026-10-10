import { useActiveSessionProject } from "../../hooks/useActiveSessionProject";
import { QuestionComposer } from "@session/features/async-questions/QuestionComposer";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useCCStore } from "@session/stores/cc";
import { synchronizeBuiltinInputTarget } from "@session/services/builtinInputNavigation";
import { useEffect } from "react";
import { AcpComposer } from "@session/components/acp/AcpComposer";
import { Composer as CCComposer } from "@session/components/cc/composer";
import { Composer as CodexComposer } from "@session/components/codex/composer";
import { useAgentCenterStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { WorkspaceSwitcher } from "../common";
import { selectedAgentCard } from "@session/stores/useAgentCenterStore";
import { useSessionName } from "@session/stores/useSessionNameStore";
import { useCodexStore } from "@session/components/codex/stores";
import { shouldAutoFocusComposer } from "../codex/composer/composerFocus";

const focusCCInput = () =>
  window.dispatchEvent(new Event("cc-input-focus-request"));

export function AgentComposer() {
  const { selectedAgent } = useAgentSettingsStore();
  const acpActive = useAcpStore((s) => s.active);
  const acpTitle = useAcpStore((s) => s.agentTitle || s.agentId || "ACP");
  const acpSessionId = useAcpStore((s) =>
    s.sessionId ? `${s.agentId}:${s.sessionId}` : null,
  );
  const project = useActiveSessionProject();
  const tabs = useAgentCenterStore();
  const { currentAgentCardId } = tabs;
  const card = selectedAgentCard(tabs);
  const effectiveAgent = card?.kind ?? selectedAgent;
  const ccSessionId = useCCStore((s) => s.activeSessionId);
  const visible = useAgentInteractionVisible();
  const nativeTitle = useCodexStore((s) => {
    const id =
      card?.kind === "codex"
        ? card.id
        : effectiveAgent === "codex"
          ? s.currentThreadId
          : null;
    const thread = id ? s.threads.find((t) => t.id === id) : undefined;
    return thread?.name || thread?.preview;
  });
  const currentThreadId = useCodexStore((s) => s.currentThreadId);
  const senderId = effectiveAgent === "cc" ? ccSessionId : currentThreadId;
  const targetId = card?.id ?? senderId;
  const mismatchedTarget = !acpActive && !!card && senderId !== card.id;
  useEffect(() => {
    if (!visible || acpActive || !card) return;
    if (selectedAgent !== card.kind)
      useAgentSettingsStore.getState().setSelectedAgent(card.kind);
    if (mismatchedTarget) synchronizeBuiltinInputTarget(card);
  }, [
    visible,
    acpActive,
    card?.id,
    card?.kind,
    selectedAgent,
    mismatchedTarget,
  ]);
  const targetTitle = useSessionName(
    acpActive ? "acp" : effectiveAgent,
    acpActive
      ? acpSessionId
      : effectiveAgent === "codex" && !card
        ? null
        : targetId,
    acpActive
      ? acpTitle
      : nativeTitle || card?.preview || targetId?.slice(0, 12) || "新聊天",
    acpActive ? undefined : nativeTitle || undefined,
  );

  // Preserve desktop refocus without opening a touch keyboard during navigation.
  useEffect(() => {
    if (!visible || selectedAgent !== "cc" || !shouldAutoFocusComposer())
      return;
    focusCCInput();
  }, [selectedAgent, visible]);

  const targetLabel = (
    <div
      className="session-input-target session-input-target-compact"
      title={`${targetTitle} · ${project.path || "项目未知"}`}
    >
      <span>发送至</span>
      <strong>
        <span className="session-target-name">{targetTitle}</span>
        <span aria-hidden="true"> · </span>
        <span className="session-target-project">{project.label}</span>
      </strong>
      <span className="session-target-agent">
        {acpActive ? acpTitle : effectiveAgent === "cc" ? "Claude" : "Codex"}
      </span>
    </div>
  );
  return (
    <div className="flex flex-col session-composer-target-container">
      {/* Input area */}
      <div className="shrink-0">
        {acpActive ? (
          <AcpComposer targetLabel={targetLabel} />
        ) : mismatchedTarget ? (
          <div role="status" className="p-3 text-sm text-muted-foreground">
            正在同步会话输入目标…
          </div>
        ) : effectiveAgent === "cc" ? (
          <CCComposer targetLabel={targetLabel} />
        ) : currentThreadId ? (
          <QuestionComposer
            compact
            key={currentThreadId}
            threadId={currentThreadId}
          >
            <CodexComposer targetLabel={targetLabel} />
          </QuestionComposer>
        ) : (
          <CodexComposer targetLabel={targetLabel} />
        )}
      </div>
      {!currentAgentCardId && <WorkspaceSwitcher />}
    </div>
  );
}
