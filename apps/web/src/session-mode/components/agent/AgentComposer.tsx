import { useEffect } from "react";
import { AcpComposer } from "@session/components/acp/AcpComposer";
import { Composer as CCComposer } from "@session/components/cc/composer";
import { Composer as CodexComposer } from "@session/components/codex/composer";
import { useAgentCenterStore, useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { WorkspaceSwitcher } from "../common";
import { selectedAgentCard } from "@session/stores/useAgentCenterStore";
import { useSessionName } from "@session/stores/useSessionNameStore";
import { useCodexStore } from "@session/components/codex/stores";

const focusCCInput = () =>
  window.dispatchEvent(new Event("cc-input-focus-request"));

export function AgentComposer() {
  const { selectedAgent } = useAgentSettingsStore();
  const acpActive = useAcpStore((s) => s.active);
  const cwd = useWorkspaceStore((s) => s.cwd);
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

  return (
    <div className="flex flex-col">
      {!acpActive && (
        <div className="session-input-target" title={card?.cwd ?? undefined}>
          <span>发送到</span>
          <strong>
            {card
              ? `${card.cwd?.split("/").filter(Boolean).at(-1) || "项目"} / ${targetTitle} · ${card.kind === "codex" ? "Codex" : "Claude"}`
              : `${cwd?.split("/").filter(Boolean).at(-1) || "选择项目"} / 新聊天 · ${selectedAgent === "cc" ? "Claude" : "Codex"}`}
          </strong>
        </div>
      )}
      {/* Input area */}
      <div className={`shrink-0 ${currentAgentCardId && "pb-2"}`}>
        {acpActive ? (
          <AcpComposer />
        ) : selectedAgent === "cc" ? (
          <CCComposer />
        ) : (
          <CodexComposer />
        )}
      </div>
      {!currentAgentCardId && <WorkspaceSwitcher />}
    </div>
  );
}
