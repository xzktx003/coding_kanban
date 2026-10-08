import { listenInSessionMode } from "@session/session-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { AppSideBar, RightPanel } from "@session/components/layout";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@session/components/ui/resizable";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@session/components/ui/sidebar";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useEdgeSwipe } from "@session/hooks/useEdgeSwipe";
import { useLayoutStore } from "@session/stores";

const SettingsView = lazy(
  () => import("@session/components/settings/SettingsView"),
);
const PluginsView = lazy(
  () => import("@session/features/plugins/components/PluginsView"),
);
const AgentsMdView = lazy(() => import("@session/views/AgentsMdView"));
const AgentView = lazy(() => import("@session/components/agent/AgentView"));
const AutoMationsView = lazy(() =>
  import("../../features/automations").then((module) => ({
    default: module.AutoMationsView,
  })),
);
const InsightsView = lazy(
  () => import("@session/features/insight/InsightsView"),
);
const BotChatView = lazy(() => import("@session/components/bot/BotChatView"));

// Inner component so it can call useSidebar() inside SidebarProvider
const MIN_RIGHT_PANEL_SIZE = 22;
const MAX_RIGHT_PANEL_SIZE = 75;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function LayoutContent({ mainContent }: { mainContent: React.ReactNode }) {
  const {
    isSidebarOpen,
    setSidebarOpen,
    isRightPanelOpen,
    setRightPanelOpen,
    rightPanelSize,
    openRightPanelTabs,
    setRightPanelSize,
    view,
    isRightPanelFocused,
  } = useLayoutStore();
  // Right panel (diff/tasks/notes/files/preview) only makes sense alongside the
  // agent thread — other views (history, automations, settings, ...) hide it.
  const canShowRightPanel = view === "agent";
  const isRightPanelVisible = canShowRightPanel && isRightPanelOpen;
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const mainPanelRef = useRef<ImperativePanelHandle>(null);
  const isMobile = useIsMobile();
  const mobileEditorOpen =
    isMobile && isRightPanelVisible && openRightPanelTabs.includes("vscode");
  // Focus mode hides the main agent thread so the right panel (diff/tasks/etc.)
  // can take the full width — useful when reviewing a diff or reading notes
  // without the agent chat competing for attention.
  const isFocusModeActive =
    canShowRightPanel &&
    isRightPanelVisible &&
    isRightPanelFocused &&
    !isMobile;
  const hasInitializedMobileLayoutRef = useRef(false);
  const { setOpenMobile, openMobile } = useSidebar();
  const projectOpener = useRef<HTMLElement | null>(null);
  const wasDrawerOpen = useRef(false);
  const wasSidebarOpen = useRef(isSidebarOpen);
  useEffect(() => {
    if (wasSidebarOpen.current && !isSidebarOpen && !isMobile && document.activeElement?.closest('[data-sidebar="sidebar"]'))
      document.querySelector<HTMLButtonElement>('.session-global-projects')?.focus();
    wasSidebarOpen.current=isSidebarOpen;
  }, [isSidebarOpen,isMobile]);
  useEffect(() => listenInSessionMode(window, 'session-open-projects', () => {
    projectOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (isMobile) setOpenMobile(true);
    else setSidebarOpen(true);
  }), [isMobile, setOpenMobile, setSidebarOpen]);
  useEffect(() => {
    if (wasDrawerOpen.current && !openMobile) requestAnimationFrame(()=>{
      const target = projectOpener.current;
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLButtonElement>(".session-global-projects")?.focus();
    });
    wasDrawerOpen.current = openMobile;
  }, [openMobile]);

  useEdgeSwipe({ onSwipeRight: () => setOpenMobile(true), enabled: isMobile });

  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (isMobile) {
      panel.collapse();
      return;
    }
    if (isFocusModeActive) {
      panel.expand();
      return;
    }
    if (isRightPanelVisible) {
      const nextSize = clamp(
        rightPanelSize,
        MIN_RIGHT_PANEL_SIZE,
        MAX_RIGHT_PANEL_SIZE,
      );
      panel.resize(nextSize);
      panel.expand();
      if (nextSize !== rightPanelSize) setRightPanelSize(nextSize);
    } else {
      panel.collapse();
    }
  }, [
    isFocusModeActive,
    isMobile,
    isRightPanelVisible,
    rightPanelSize,
    setRightPanelSize,
  ]);

  useEffect(() => {
    if (!isMobile) {
      hasInitializedMobileLayoutRef.current = false;
      return;
    }
    if (hasInitializedMobileLayoutRef.current) return;
    hasInitializedMobileLayoutRef.current = true;
    if (isSidebarOpen) setSidebarOpen(false);
    if (isRightPanelOpen && !openRightPanelTabs.includes("vscode"))
      setRightPanelOpen(false);
  }, [
    isMobile,
    isRightPanelOpen,
    isSidebarOpen,
    openRightPanelTabs,
    setRightPanelOpen,
    setSidebarOpen,
  ]);

  const handleRightPanelResize = (size: number) => {
    if (!isRightPanelVisible || isFocusModeActive || size <= 0) return;
    const nextSize = clamp(size, MIN_RIGHT_PANEL_SIZE, MAX_RIGHT_PANEL_SIZE);
    if (nextSize !== rightPanelSize) setRightPanelSize(nextSize);
  };

  // Focus mode collapses the main panel instead of swapping the tree, so the
  // right panel (and long-lived children like the terminal) stays mounted.
  useEffect(() => {
    const panel = mainPanelRef.current;
    if (!panel) return;
    if (isFocusModeActive) panel.collapse();
    else panel.expand();
  }, [isFocusModeActive]);

  return (
    <SidebarInset className="app-main-bg min-w-0 overflow-hidden h-full">
      <div className="relative flex flex-1 flex-col min-h-0 h-full">
        <ResizablePanelGroup
          direction="horizontal"
          className="flex min-h-0 min-w-0 w-full flex-1"
        >
          <ResizablePanel
            ref={mainPanelRef}
            defaultSize={
              isRightPanelVisible && !isMobile ? 100 - rightPanelSize : 100
            }
            minSize={25}
            collapsible
            collapsedSize={0}
          >
            <div
              className="h-full min-h-0"
              hidden={isFocusModeActive}
              inert={isFocusModeActive || mobileEditorOpen}
            >
              {mainContent}
            </div>
          </ResizablePanel>
          <>
            <ResizableHandle
              withHandle
              className={
                isMobile || !isRightPanelVisible || isFocusModeActive
                  ? "hidden"
                  : ""
              }
            />
            <ResizablePanel
              ref={rightPanelRef}
              defaultSize={
                isRightPanelVisible && !isMobile ? rightPanelSize : 0
              }
              minSize={MIN_RIGHT_PANEL_SIZE}
              // Focus mode collapses the main panel, so the right panel must
              // be allowed to take the whole width.
              maxSize={isFocusModeActive ? 100 : MAX_RIGHT_PANEL_SIZE}
              onResize={handleRightPanelResize}
              collapsible
              collapsedSize={0}
              onCollapse={() => {
                if (!isMobile && canShowRightPanel) setRightPanelOpen(false);
              }}
              onExpand={() => {
                if (!isMobile && canShowRightPanel) setRightPanelOpen(true);
              }}
              // On mobile the right panel is rendered as an overlay below.
              style={{ overflow: isMobile ? "visible" : "hidden" }}
            >
              <div
                className={
                  isMobile
                    ? `absolute inset-y-0 right-0 z-40 ${openRightPanelTabs.includes("vscode") ? "w-full" : "w-[min(92vw,420px)]"}`
                    : "h-full"
                }
                hidden={!isRightPanelVisible}
                inert={!isRightPanelVisible}
              >
                <RightPanel visible={isRightPanelVisible} />
              </div>
            </ResizablePanel>
          </>
        </ResizablePanelGroup>

        <button
          type="button"
          hidden={!isMobile || !isRightPanelVisible}
          className="absolute inset-0 z-30 bg-black/40"
          aria-label="关闭工具面板"
          onClick={() => setRightPanelOpen(false)}
        />
      </div>
    </SidebarInset>
  );
}

const ViewLoadingFallback = () => (
  <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
    正在加载界面…
  </div>
);

export function AppLayout() {
  const { view, setView, isSidebarOpen, setSidebarOpen } = useLayoutStore();
  const hasOpenedAgent = useRef(false);
  if (view === "agent") hasOpenedAgent.current = true;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="alertdialog"]'))
      )
        return;
      if (
        document.querySelector(
          '.session-mode [data-slot="dialog-content"][data-state="open"], .session-mode [data-slot="alert-dialog-content"][data-state="open"]',
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setView("settings");
      }
    };
    const stopHandleKeyDownForSession = listenInSessionMode(
      window,
      "keydown",
      handleKeyDown,
    );
    return () => stopHandleKeyDownForSession();
  }, [setView]);

  const mainContent = (
    <div className="flex flex-col min-w-0 h-full">
      <div className="min-h-0 flex-1">
        <Suspense fallback={<ViewLoadingFallback />}>
          {view === "agents-md" && <AgentsMdView />}
          {hasOpenedAgent.current && (
            <div
              className="h-full min-h-0"
              hidden={view !== "agent"}
              inert={view !== "agent"}
            >
              <AgentView />
            </div>
          )}
          {view === "automations" && <AutoMationsView />}
          {view === "plugins" && <PluginsView />}
          {view === "insights" && <InsightsView />}
          {view === "bot" && <BotChatView />}
        </Suspense>
      </div>
    </div>
  );

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <div
        className="h-full min-h-0"
        hidden={view === "settings"}
        inert={view === "settings"}
      >
        <SidebarProvider
          open={isSidebarOpen}
          onOpenChange={setSidebarOpen}
          className="h-full min-h-0"
        >
          <AppSideBar />
          {/* Single layout component for both mobile and desktop.
              Keeping mainContent at a stable tree position prevents lazy views
              from unmounting/remounting when the viewport crosses the mobile breakpoint. */}
          <LayoutContent mainContent={mainContent} />
        </SidebarProvider>
      </div>
      {view === "settings" && (
        <div className="absolute inset-0">
          <Suspense fallback={<ViewLoadingFallback />}>
            <SettingsView />
          </Suspense>
        </div>
      )}
    </div>
  );
}
