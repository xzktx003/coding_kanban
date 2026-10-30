import { listenInSessionMode } from "@session/session-dom";
import { SquarePen, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { acpFreshSession } from "@session/components/acp/newSession";
import { useNewThread } from "@session/components/codex/hooks";
import { Button } from "@session/components/ui/button";
import { useCCSessionManager } from "@session/hooks/useCCSessionManager";
import { useAgentCenterStore, useLayoutStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { selectedAgentCard } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { toast } from "@session/components/ui/use-toast";

const focusCCInput = () =>
  window.dispatchEvent(new Event("cc-input-focus-request"));

type Props = {
  showLabel?: boolean;
  icon?: LucideIcon;
};

export function NewAgentButton({
  showLabel = false,
  icon: Icon = SquarePen,
}: Props) {
  const { t } = useTranslation("sidebar");
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const { cwd, setCwd } = useWorkspaceStore();
  const preferredAgent = useAgentSettingsStore((s) => s.selectedAgent);
  const focusedCard = useAgentCenterStore(selectedAgentCard);
  const selectedAgent = focusedCard?.kind ?? preferredAgent;
  const { setCurrentAgentCardId } = useAgentCenterStore();
  const { view, setView, setActiveSidebarTab } = useLayoutStore();
  const { handleNewSession } = useCCSessionManager();
  const { handleNewThread } = useNewThread();
  const {
    active: acpActive,
    connectionId: acpConnectionId,
    restart: acpRestart,
  } = useAcpStore();

  const handleCreateNew = useCallback(
    async (project?: string) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);
      try {
        if (project && project !== cwd) setCwd(project);

        if (acpActive) {
          setView("agent");
          // Keep busy/uncertain owners alive; the helper creates an independent
          // connection for the new target when sharing the process is unsafe.
          const target = project ?? cwd;
          if (
            acpConnectionId &&
            target &&
            (await acpFreshSession(acpConnectionId, target))
          ) {
            return;
          }
          // The old process may already be gone; a fresh session works regardless.
          if (acpConnectionId) {
            toast({
              title: "新建会话失败",
              description: "当前会话记录已保留，请重试或显式重新连接 Agent。",
              variant: "destructive",
            });
            return;
          }
          acpRestart();
          return;
        }

        if (selectedAgent === "cc") {
          setActiveSidebarTab("cc");
          setCurrentAgentCardId(null);
          setView("agent");
          await handleNewSession();
          focusCCInput();
          return;
        }
        await handleNewThread();
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [
      acpActive,
      acpConnectionId,
      acpRestart,
      cwd,
      handleNewSession,
      handleNewThread,
      selectedAgent,
      setActiveSidebarTab,
      setCwd,
      setCurrentAgentCardId,
      setView,
    ],
  );

  // Keyboard shortcut: Cmd/Ctrl+N → new thread / session
  // NOTE: this must fire even when focus is inside the composer textarea
  // (e.g. an existing thread is open), so it intentionally does NOT skip
  // editable targets like other shortcuts do.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isNew = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n";
      if (!isNew || e.defaultPrevented || e.shiftKey || e.altKey || e.repeat)
        return;
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [role="alertdialog"]')
      )
        return;
      if (
        document.querySelector(
          '.session-mode [data-slot="dialog-content"][data-state="open"], .session-mode [data-slot="alert-dialog-content"][data-state="open"]',
        )
      )
        return;
      if (view !== "agent") return;
      e.preventDefault();
      e.stopPropagation();
      void handleCreateNew();
    };

    const stopHandleKeyDownForSession = listenInSessionMode(
      window,
      "keydown",
      handleKeyDown,
    );
    return () => stopHandleKeyDownForSession();
  }, [handleCreateNew, view]);

  return (
    <>
      <Button
        onClick={() => void handleCreateNew()}
        size={showLabel ? "default" : "icon"}
        variant="ghost"
        className={`group ${showLabel ? "justify-start" : ""} relative flex items-center gap-2`}
        aria-label={t("newChat")}
        disabled={creating}
        aria-busy={creating}
        title={`${t("newChat")} (⌘N)`}
      >
        <Icon size={16} />
        {showLabel && (
          <div className="flex items-center justify-between w-full">
            <span>{t("newChat")}</span>
            <span className="hidden group-hover:inline text-xs text-muted-foreground ml-2">
              ⌘N
            </span>
          </div>
        )}
      </Button>
    </>
  );
}
