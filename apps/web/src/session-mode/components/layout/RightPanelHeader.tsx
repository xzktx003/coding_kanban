import {
  GitBranch,
  Diff,
  Files,
  Globe,
  Kanban,
  ListTodo,
  ArrowLeft,
  Maximize2,
  Minimize2,
  PanelRight,
  SquareTerminal,
  X,
} from "lucide-react";
import { useRef, type ComponentType } from "react";
import { VsCodeIcon } from "@session/features/vscode/VsCodeIcon";
import { NewAgentButton } from "@session/components/common/NewAgentButton";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { SidebarTrigger } from "@session/components/ui/sidebar";
import { useTrafficLightConfig } from "@session/hooks";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useLayoutStore } from "@session/stores";
import type { RightPanelTab } from "@session/stores/useLayoutStore";
import { useTodoStore } from "@session/stores/useTodoStore";

export type { RightPanelTab };

interface TabConfig {
  tab: RightPanelTab;
  icon: ComponentType<{ className?: string }>;
  label: string;
}

// Order tabs the way users scan them: work-in-progress first, reference last.
const TAB_BUTTONS: TabConfig[] = [
  { tab: "subagents", icon: GitBranch, label: "子任务" },
  { tab: "diff", icon: Diff, label: "变更" },
  { tab: "todo", icon: ListTodo, label: "待办" },
  { tab: "vscode", icon: VsCodeIcon, label: "VS Code" },
  { tab: "terminal", icon: SquareTerminal, label: "终端" },
  { tab: "webpreview", icon: Globe, label: "浏览器" },
  { tab: "files", icon: Files, label: "文件" },
  { tab: "tasks", icon: Kanban, label: "看板" },
];

export function RightPanelHeader() {
  const isMobile = useIsMobile();
  const headerRef = useRef<HTMLDivElement>(null);
  const {
    activeRightPanelTab,
    setActiveRightPanelTab,
    openRightPanelTabs,
    closeRightPanelTab,
    isRightPanelOpen,
    setRightPanelOpen,
    toggleRightPanel,
    isRightPanelFocused,
    toggleRightPanelFocused,
    isSidebarOpen,
  } = useLayoutStore();
  const { needsTrafficLightOffset } = useTrafficLightConfig(isSidebarOpen);
  const todos = useTodoStore((state) => state.todos);

  const openTab = (tab: RightPanelTab) => {
    setActiveRightPanelTab(tab);
    setRightPanelOpen(true);
  };

  const closeTab = (event: React.MouseEvent, tab: RightPanelTab) => {
    event.stopPropagation();
    const restoreFocus = event.currentTarget === document.activeElement;
    closeRightPanelTab(tab);
    if (restoreFocus)
      requestAnimationFrame(() => {
        const next = headerRef.current?.querySelector<HTMLButtonElement>(
          'button[data-tool-tab][aria-pressed="true"], button[data-open-tool]',
        );
        next?.focus();
      });
  };

  const closedTabs = TAB_BUTTONS.filter(
    (t) => !openRightPanelTabs.includes(t.tab),
  );

  // A captured todo lands in a panel the user may not be looking at, so the
  // tab carries the count until they open it.
  const openTodoCount = todos.filter((todo) => !todo.isDone).length;

  if (openRightPanelTabs.length === 0) {
    return (
      <div ref={headerRef} className="flex-1 min-h-0 flex flex-col">
        <div data-panel-global-controls className="flex items-center justify-end gap-0.5 p-1 shrink-0">
          {!isMobile && isRightPanelOpen && (
            <Button
              variant={isRightPanelFocused ? "secondary" : "ghost"}
              size="icon"
              onClick={toggleRightPanelFocused}
              aria-label={isRightPanelFocused ? "退出工具聚焦" : "聚焦工具面板"}
              aria-pressed={isRightPanelFocused}
              title={isRightPanelFocused ? "退出工具聚焦" : "聚焦工具面板"}
            >
              {isRightPanelFocused ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleRightPanel}
            title="隐藏工具面板"
            aria-label="隐藏工具面板"
          >
            <PanelRight className="size-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2">
          <span className="text-xs text-muted-foreground">选择工作工具</span>
          <div className="flex flex-col items-center gap-1">
            {TAB_BUTTONS.map(({ tab, icon: Icon, label }) => (
              <Button
                key={tab}
                variant="ghost"
                size="sm"
                onClick={() => openTab(tab)}
                data-open-tool
                aria-label={label}
                className="gap-2 px-3 justify-start w-36 min-h-10"
              >
                <Icon className="size-4" />
                <span className="text-xs">{label}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={headerRef}
      className={`flex items-center justify-between gap-1 py-1 h-11 border-b border-border shrink-0 ${needsTrafficLightOffset && isRightPanelFocused && !isMobile ? "pl-20" : ""}`}
    >
      <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 size-11"
            aria-label="返回会话"
            title="返回会话"
            onClick={() => setRightPanelOpen(false)}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        {isRightPanelFocused && !isMobile && !isSidebarOpen && (
          <>
            <SidebarTrigger />
            <NewAgentButton />
          </>
        )}
        {openRightPanelTabs.map((tab) => {
          const config = TAB_BUTTONS.find((t) => t.tab === tab);
          if (!config) return null;
          const Icon = config.icon;
          return (
            <div key={tab} className="relative group shrink-0">
              <Button
                variant={activeRightPanelTab === tab ? "secondary" : "ghost"}
                size="sm"
                onClick={() => openTab(tab)}
                data-tool-tab={tab}
                aria-label={config.label}
                aria-pressed={activeRightPanelTab === tab}
                title={config.label}
                className="gap-1.5 pl-2 pr-9 h-9"
              >
                <Icon className="size-4" />
                <span
                  className={`text-xs ${tab === "vscode" || tab === "terminal" ? "" : "hidden lg:block"}`}
                >
                  {config.label}
                </span>
                {tab === "todo" &&
                  openTodoCount > 0 &&
                  activeRightPanelTab !== tab && (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
                      {openTodoCount}
                    </span>
                  )}
              </Button>
              <button
                type="button"
                onClick={(e) => closeTab(e, tab)}
                title={
                  tab === "terminal"
                    ? "关闭终端面板（结束其中所有终端进程）"
                    : `关闭${config.label}面板`
                }
                aria-label={
                  tab === "terminal"
                    ? "关闭终端面板（结束其中所有终端进程）"
                    : `关闭${config.label}面板`
                }
                className="absolute right-0.5 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded opacity-100 lg:opacity-0 lg:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent transition-opacity"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {closedTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 size-9"
                data-open-tool
                title="打开工具"
                aria-label="打开工具"
              >
                <span className="text-base leading-none">+</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {closedTabs.map(({ tab, icon: Icon, label }) => (
                <DropdownMenuItem key={tab} onClick={() => openTab(tab)}>
                  <Icon className="size-4" />
                  {label}
                  {tab === "todo" && openTodoCount > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {openTodoCount}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div data-panel-global-controls className="flex items-center gap-0.5 shrink-0">
        {!isMobile && isRightPanelOpen && (
          <Button
            variant={isRightPanelFocused ? "secondary" : "ghost"}
            size="icon"
            onClick={toggleRightPanelFocused}
            aria-label={isRightPanelFocused ? "退出工具聚焦" : "聚焦工具面板"}
            aria-pressed={isRightPanelFocused}
            title={isRightPanelFocused ? "退出工具聚焦" : "聚焦工具面板"}
          >
            {isRightPanelFocused ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRightPanel}
          title="隐藏工具面板"
          aria-label="隐藏工具面板"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
