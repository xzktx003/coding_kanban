import { SessionRowTitle } from "../common/SessionRowTitle";
import { useAcpStore } from "@session/stores/useAcpStore";
import { SessionAgentBadge } from "../common/SessionAgentBadge";
import { UnreadDot } from "../common/SessionStatus";
import { useSessionNameStore } from "../../stores/useSessionNameStore";
// Pinned threads/sessions across all projects, shown as a collapsible sidebar section.
import { ChevronDown, ChevronRight, Pin, PinOff } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@session/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@session/components/ui/collapsible";
import { useCCSessionManager } from "@session/hooks/useCCSessionManager";
import { codexService } from "@session/services/codexService";
import { useAgentCenterStore, useLayoutStore } from "@session/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { type PinnedItem, usePinStore } from "@session/stores/usePinStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { getFilename } from "@session/utils/getFilename";

export function SideBarPinnedList() {
  const names = useSessionNameStore((s) => s.names);
  const pinned = usePinStore((s) => s.pinned);
  const unpin = usePinStore((s) => s.unpin);
  const { setCwd } = useWorkspaceStore();
  const { setView, setActiveSidebarTab } = useLayoutStore();
  const open = useLayoutStore((s) => s.isPinnedListOpen);
  const setOpen = useLayoutStore((s) => s.setPinnedListOpen);
  const { setSelectedAgent } = useAgentSettingsStore();
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const { handleSessionSelect } = useCCSessionManager();

  const handleOpen = useCallback(
    async (item: PinnedItem) => {
      setCwd(item.cwd);
      addAgentCard({
        kind: item.kind,
        id: item.id,
        preview: item.title,
        cwd: item.cwd,
      });
      setCurrentAgentCardId(item.id);
      useAcpStore.getState().setActive(false);
      setSelectedAgent(item.kind);
      setActiveSidebarTab(item.kind);
      setView("agent");
      if (item.kind === "codex") {
        await codexService.setCurrentThread(item.id);
      } else {
        await handleSessionSelect(item.id, item.cwd);
      }
    },
    [
      addAgentCard,
      handleSessionSelect,
      setActiveSidebarTab,
      setCurrentAgentCardId,
      setCwd,
      setSelectedAgent,
      setView,
    ],
  );

  if (pinned.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent/50">
        <Pin className="h-4 w-4" />
        <span className="flex-1 text-left">置顶会话</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {pinned.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => void handleOpen(item)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void handleOpen(item);
              }
            }}
            title={`${names[`${item.kind}:${item.id}`] ?? item.title}\n${item.cwd}`}
            className="group/session-row session-nav-row flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left hover:bg-accent/50"
          >
            <div className="session-nav-title">
            <SessionAgentBadge kind={item.kind} />
            <SessionRowTitle title={names[`${item.kind}:${item.id}`] ?? (item.title || "Untitled")} detail={item.cwd} />
            <UnreadDot kind={item.kind} id={item.id} />
            </div>
            <div className="session-nav-meta">
            <span className="session-pinned-project shrink-0 text-[10px] text-muted-foreground group-hover/session-row:hidden group-focus-within/session-row:hidden">
              {getFilename(item.cwd)}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              title="取消置顶"
              aria-label={`取消置顶${names[`${item.kind}:${item.id}`] ?? item.title}`}
              className="session-row-menu"
              onClick={(e) => {
                e.stopPropagation();
                unpin(item.id);
              }}
            >
              <PinOff />
            </Button>
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
