import { useActiveSessionProject } from "../../hooks/useActiveSessionProject";
import { ConversationMenu } from "../codex/composer/ConversationMenu";
import { QuestionComposer } from "@session/features/async-questions/QuestionComposer";
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
import { ModelChangeNotice } from "../codex/composer/ModelChangeNotice";

const focusCCInput = () =>
  window.dispatchEvent(new Event("cc-input-focus-request"));

export function AgentComposer() {
  const { selectedAgent } = useAgentSettingsStore();
  const acpActive = useAcpStore((s) => s.active);
  const project = useActiveSessionProject();
  const tabs = useAgentCenterStore();
  const { currentAgentCardId } = tabs;
  const card = selectedAgentCard(tabs);
  const nativeTitle = useCodexStore((s) => {
    const thread =
      card?.kind === "codex"
        ? s.threads.find((t) => t.id === card.id)
        : undefined;
    return thread?.name || thread?.preview;
  });
  const currentThreadId = useCodexStore((s) => s.currentThreadId);
  const targetTitle = useSessionName(
    card?.kind ?? "codex",
    card?.id ?? null,
    nativeTitle || card?.preview || card?.id.slice(0, 12) || "新聊天",
    nativeTitle || undefined,
  );

  // Auto-focus the CC composer input when switching to the cc agent
  useEffect(() => {
    if (selectedAgent === "cc") {
      focusCCInput();
    }
  }, [selectedAgent]);

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
      {selectedAgent === "codex" && (
        <ConversationMenu threadId={currentThreadId} title={targetTitle} />
      )}
    </div>
  );
  return (
    <div className="flex flex-col session-composer-target-container">
      {/* Input area */}
      {!acpActive && selectedAgent === "codex" && currentThreadId && (
        <ModelChangeNotice threadId={currentThreadId} />
      )}
      <div className={`shrink-0 ${currentAgentCardId && "pb-2"}`}>
        {acpActive ? (
          <AcpComposer />
        ) : selectedAgent === "cc" ? (
          <CCComposer targetLabel={targetLabel} />
        ) : currentThreadId ? (
          <QuestionComposer key={currentThreadId} threadId={currentThreadId}>
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
