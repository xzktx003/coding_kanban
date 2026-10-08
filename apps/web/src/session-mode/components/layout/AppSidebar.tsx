import { UnreadCount } from "../common/SessionStatus";
import { PROJECT_ISSUES_URL } from "../../../lib/product-links";
import {
  Bug,
  ChevronDown,
  ChevronRight,
  Monitor,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NewAgentButton } from "../common/NewAgentButton";
import { useTranslation } from "react-i18next";
import { SideBarBotPane } from "@session/components/bot";
import { BotNotifications } from "@session/components/bot/BotNotifications";
import { BotSettingsDialog } from "@session/components/bot/BotSettingsDialog";
import { useCreateBot } from "@session/components/bot/useCreateBot";
import { DesktopDrawer } from "@session/components/pairing/DesktopDrawer";
import { Button } from "@session/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@session/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@session/components/ui/sidebar";
import { useIsMobile } from "@session/hooks/use-mobile";
import { isPhone } from "@session/hooks/runtime";
import { useLayoutStore } from "@session/stores";
import { UpdateIndicator } from "../../features/UpdateIndicator";
import { SessionManagerDialog } from "../common/SessionManagerDialog";
import {
  SideBarAgentList,
  SideBarProjectActions,
} from "./SideBarAgentPane";
import { SideBarPinnedList } from "./SideBarPinnedList";
import { UserInfo } from "./UserInfo";

export function AppSideBar() {
  const mobile = useIsMobile();
  const { t } = useTranslation("sidebar");
  const { activeSidebarTab, sidebarMode, setHasSeenBotTab } = useLayoutStore();
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useState(sidebarMode === "bot");
  const [projectsOpen, setProjectsOpen] = useState(sidebarMode === "agent");
  // Only a phone drives a remote machine; a desktop is its own backend and has
  // nothing to switch between.
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState(false);
  const { newBot, setNewBot, creating, handleCreateBot } = useCreateBot();
  const setView = useLayoutStore((s) => s.setView);
  useEffect(() => {
    let frame = 0;
    const reveal = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail;
      if (typeof path !== "string") return;
      setProjectsOpen(true);
      useLayoutStore.getState().setProjectExpanded(path, true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const row = Array.from(document.querySelectorAll<HTMLElement>(".session-mode [data-project-path]"))
          .find(element => element.dataset.projectPath === path);
        row?.querySelector<HTMLButtonElement>("button")?.focus();
      });
    };
    window.addEventListener("session-reveal-project", reveal);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("session-reveal-project", reveal); };
  }, []);

  return (
    <>
      <Sidebar className="border-r border-sidebar-border bg-zinc-100/95 dark:bg-zinc-900/95">
        <SidebarHeader className="session-sidebar-header">
          {/* Desktop uses the fixed top navigation toggle; the modal drawer needs its own close action. */}
          <div
            className="session-sidebar-search-row"
            data-tauri-drag-region
          >
            {mobile && <SidebarTrigger aria-label="收起项目列表" title="收起项目列表" />}
            <Button
              variant="ghost"
              size="sm"
              className="session-search-trigger gap-2"
              title="搜索和管理会话"
              aria-label="搜索和管理会话"
              onClick={() => setSessionManagerOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span>搜索会话</span>
            </Button>
            <NewAgentButton />
            {isPhone() && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Desktops"
                onClick={() => setDesktopDrawerOpen(true)}
              >
                <Monitor className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent className="min-w-0 max-w-full overflow-x-hidden gap-0 px-0">


          <SideBarPinnedList />

          <Collapsible className="session-sidebar-projects" open={projectsOpen} onOpenChange={setProjectsOpen}>
            <div className="flex items-center px-1">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 justify-start gap-2"
                  aria-label="项目列表"
                >
                  <span>项目</span>
                  <UnreadCount />
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground/60 transition-transform ${projectsOpen ? "" : "-rotate-90"}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <SideBarProjectActions />
            </div>
            <CollapsibleContent>
              <SideBarAgentList />
            </CollapsibleContent>
          </Collapsible>
        </SidebarContent>

          <Collapsible
            className="session-sidebar-bots"
            open={botsOpen}
            onOpenChange={(open) => {
              setBotsOpen(open);
              if (open) setHasSeenBotTab(true);
            }}
          >
            <div className="flex items-center px-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start"
                onClick={() => {
                  setBotsOpen(true);
                  setHasSeenBotTab(true);
                  setView("bot");
                }}
              >
                机器人
              </Button>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={botsOpen ? "折叠机器人" : "展开机器人"}
                >
                  <ChevronRight
                    className={`h-4 w-4 text-muted-foreground/60 transition-transform ${botsOpen ? "rotate-90" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <BotNotifications />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title={t("newBot")}
                aria-label={t("newBot")}
                onClick={handleCreateBot}
                disabled={creating}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <CollapsibleContent>
              <SideBarBotPane />
            </CollapsibleContent>
          </Collapsible>

        <SidebarFooter className="flex-row items-center p-0 min-w-0 max-w-full overflow-x-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            <UserInfo />
          </div>
          <div className="flex-shrink-0 pr-2 flex items-center gap-2">
            <UpdateIndicator
              fallback={
                <a
                  href={PROJECT_ISSUES_URL}
                  aria-label="Issues"
                  title="反馈问题"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Bug className="h-4 w-4" />
                </a>
              }
            />
          </div>
        </SidebarFooter>
      </Sidebar>

      <SessionManagerDialog
        open={sessionManagerOpen}
        onOpenChange={setSessionManagerOpen}
        defaultTab={activeSidebarTab === "cc" ? "cc" : "codex"}
      />

      {newBot && (
        <BotSettingsDialog
          bot={newBot}
          open={Boolean(newBot)}
          onOpenChange={(open) => {
            if (!open) setNewBot(null);
          }}
        />
      )}

      {isPhone() && (
        <DesktopDrawer
          open={desktopDrawerOpen}
          onOpenChange={setDesktopDrawerOpen}
        />
      )}
    </>
  );
}
