import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SessionStatus, UnreadDot } from "../common/SessionStatus";
import { RenameSessionButton } from "../common/RenameSessionButton";
import { useSessionName } from "../../stores/useSessionNameStore";
import { useAgentSettingsStore } from "../../stores/useAgentSettingsStore";
import { useAcpStore } from "../../stores/useAcpStore";
import { useShallow } from "zustand/react/shallow";
import {
  LayoutGrid,
  List,
  PanelRight,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useCodexStore } from "@session/components/codex/stores";
import { NewAgentButton } from "@session/components/common/NewAgentButton";
import { Badge } from "@session/components/ui/badge";
import { Button } from "@session/components/ui/button";
import { useSidebar } from "@session/components/ui/sidebar";
import { GitActions } from "@session/features/git";
import { isPhone } from "@session/hooks/runtime";
import { useCCStore, useLayoutStore, useWorkspaceStore } from "@session/stores";
import type { AgentCardsViewMode } from "@session/stores/useAgentCenterStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { getFilename } from "@session/utils/getFilename";
import { OpenAppMenu } from "./openApp/OpenAppMenu";
import { SessionTabs } from "./SessionTabs";

import { MobileProjectButton, MobileSessionTools } from "./MobileSessionTools";
import { ProjectNavigationButton } from "./ProjectNavigationButton";

const CARDS_VIEW_MODES: {
  mode: AgentCardsViewMode;
  icon: typeof LayoutGrid;
  title: string;
}[] = [
  { mode: "solo", icon: Square, title: "自由分屏" },
  { mode: "grid", icon: LayoutGrid, title: "多会话网格" },
  { mode: "list", icon: List, title: "会话列表" },
];

export function AgentViewHeader() {
  const {
    isRightPanelOpen,
    toggleRightPanel,
    activeRightPanelTab,
    setActiveRightPanelTab,
    setRightPanelOpen,
  } = useLayoutStore();
  const isTerminalOpen = isRightPanelOpen && activeRightPanelTab === "terminal";
  const { cardsViewMode, setCardsViewMode } = useAgentCenterStore();
  const { isMobile } = useSidebar();
  const { currentThreadId } = useCodexStore(
    useShallow((s) => ({ currentThreadId: s.currentThreadId })),
  );
  const { activeSessionId } = useCCStore();
  const { cwd } = useWorkspaceStore();
  const agent = useAgentSettingsStore((s) => s.selectedAgent);
  const acpActive = useAcpStore((s) => s.active);
  const acpAgentId = useAcpStore((s) => s.agentId);
  const displayCardsViewMode = acpActive ? "solo" : cardsViewMode;
  const acpId = useAcpStore((s) =>
    s.sessionId ? `${s.agentId}:${s.sessionId}` : null,
  );
  const kind = acpActive ? "acp" : agent === "cc" ? "cc" : "codex";
  const id =
    kind === "acp" ? acpId : kind === "cc" ? activeSessionId : currentThreadId;
  const threadTitle = useCodexStore(
    (s) =>
      s.threads.find((thread) => thread.id === currentThreadId)?.name ??
      s.threads.find((thread) => thread.id === currentThreadId)?.preview,
  );
  const card = useAgentCenterStore((s) =>
    s.cards.find((card) => card.kind === kind && card.id === id),
  );
  const title = useSessionName(
    kind,
    id,
    (kind === "codex" ? threadTitle : undefined) ||
      card?.preview ||
      id?.slice(0, 12) ||
      "",
  );
  const hasActiveSession = Boolean(id);

  // A phone gets its own header from MobileShell: no card layouts (one card
  // fills the screen), no right panel, and Back instead of a sidebar trigger.
  if (isPhone()) return null;
  if (isMobile) {
    if (!acpActive && cardsViewMode === "solo") return null;
    return (
      <div className="session-mobile-header">
        {acpActive ? (
          <>
            <MobileProjectButton />
            <span className="truncate flex-1" title={title}>
              {title || "新聊天"}
            </span>
            <MobileSessionTools />
          </>
        ) : (
          <SessionTabs />
        )}
      </div>
    );
  }

  return (
    <div
      className="session-agent-header flex items-center justify-between h-11 border-b border-border bg-sidebar/20"
      data-tauri-drag-region
    >
      <div className="session-agent-header-title flex min-w-0 items-center gap-2">
        <ProjectNavigationButton />
        {!acpActive && cardsViewMode !== "solo" && <SessionTabs />}
        {acpActive && id && (
          <>
            <span className="session-current-agent" aria-label="当前 Agent">
              {kind === "codex"
                ? "Codex"
                : kind === "cc"
                  ? "Claude"
                  : `ACP · ${acpAgentId}`}
            </span>
            <span
              className="session-current-title truncate text-sm font-medium min-w-0"
              title={title}
            >
              {title}
            </span>
            <UnreadDot kind={kind} id={id} />
            <SessionStatus kind={kind} id={id} />
            <RenameSessionButton kind={kind} id={id} title={title} />
          </>
        )}
        {acpActive && !hasActiveSession && (
          <Badge variant="secondary">{getFilename(cwd)}</Badge>
        )}
      </div>
      <span className="session-agent-header-actions flex items-center gap-1 pr-2">
        {cwd && <OpenAppMenu path={cwd} />}
        <span
          className="session-layout-switch flex items-center gap-0.5 border rounded-md p-0.5"
          role="group"
          aria-label="会话布局"
        >
          {CARDS_VIEW_MODES.map(({ mode, icon: Icon, title }) => (
            <Button
              key={mode}
              variant={displayCardsViewMode === mode ? "secondary" : "ghost"}
              size="icon"
              className="h-6 w-6"
              onClick={() => setCardsViewMode(mode)}
              disabled={acpActive && mode !== "solo"}
              title={acpActive ? `${title}（ACP 当前为单会话）` : title}
              aria-label={title}
              aria-pressed={displayCardsViewMode === mode}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="session-layout-mobile"
              variant="ghost"
              size="icon"
              aria-label="选择会话布局"
              disabled={acpActive}
              title={acpActive ? "ACP 当前为单会话" : "选择会话布局"}
            >
              <LayoutGrid className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={displayCardsViewMode}
              onValueChange={(value) =>
                setCardsViewMode(value as AgentCardsViewMode)
              }
            >
              {CARDS_VIEW_MODES.map(({ mode, title }) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {title}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {!isRightPanelOpen && (
          <>
            {hasActiveSession && <GitActions />}
            <Button
              variant={isTerminalOpen ? "secondary" : "ghost"}
              size="icon"
              onClick={() => {
                setActiveRightPanelTab("terminal");
                setRightPanelOpen(true);
              }}
              title="打开终端"
              aria-label="打开终端"
            >
              <SquareTerminal className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleRightPanel}
              title="打开工具面板"
              aria-label="打开工具面板"
            >
              <PanelRight className="size-4" />
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
