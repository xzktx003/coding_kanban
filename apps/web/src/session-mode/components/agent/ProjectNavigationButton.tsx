import {
  ChevronDown,
  Copy,
  FolderOpen,
  LocateFixed,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useSidebar } from "../ui/sidebar";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { getFilename } from "@session/utils/getFilename";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { toast } from "../ui/use-toast";

/** Shared entry usable from the outer navigation, above SidebarProvider. */
export function ProjectNavigationButton({
  compact = false,
  global = false,
}: {
  compact?: boolean;
  global?: boolean;
}) {
  if (global)
    return (
      <button
        type="button"
        className="session-top-icon session-global-projects"
        aria-label="展开项目列表"
        title="项目与会话"
        onClick={() => window.dispatchEvent(new Event("session-open-projects"))}
      >
        <PanelLeftOpen size={17} />
      </button>
    );
  return <LocalProjectNavigationButton compact={compact} />;
}

function LocalProjectNavigationButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const sidebar = useSidebar();
  const cwd = useWorkspaceStore((state) => state.cwd);
  const expanded = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(sidebar.open);
  useEffect(() => {
    if (
      wasOpen.current &&
      !sidebar.open &&
      !sidebar.isMobile &&
      document.activeElement?.closest('[data-sidebar="sidebar"]')
    )
      opener.current?.focus();
    wasOpen.current = sidebar.open;
  }, [sidebar.open, sidebar.isMobile]);
  const showProjects = () =>
    sidebar.isMobile ? sidebar.setOpenMobile(true) : sidebar.setOpen(true);
  if (compact)
    return (
      <button
        type="button"
        className="session-project-trigger session-mobile-projects"
        aria-label="项目与会话"
        aria-expanded={expanded}
        title="项目与会话列表"
        onClick={() =>
          sidebar.isMobile
            ? sidebar.setOpenMobile(!sidebar.openMobile)
            : sidebar.setOpen(!sidebar.open)
        }
      >
        <FolderOpen size={16} aria-hidden="true" />
        <span>项目</span>
      </button>
    );
  return (
    <div className="session-project-context">
      {!expanded && (
        <button
          ref={opener}
          type="button"
          className="session-project-toggle"
          aria-label="展开项目列表"
          aria-expanded={false}
          title="展开项目列表"
          onClick={showProjects}
        >
          <PanelLeftOpen size={16} aria-hidden="true" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="session-project-menu"
            aria-label={`项目：${getFilename(cwd) || "选择项目"}`}
            title={cwd || "选择项目"}
          >
            <FolderOpen size={15} aria-hidden="true" />
            <span className="session-project-context-name">
              {getFilename(cwd) || "选择项目"}
            </span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-80">
          {cwd && (
            <DropdownMenuLabel className="break-all font-normal text-xs text-muted-foreground">
              {cwd}
            </DropdownMenuLabel>
          )}
          <DropdownMenuItem onSelect={showProjects}>
            <FolderOpen size={14} />
            浏览项目列表
          </DropdownMenuItem>
          {cwd && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  showProjects();
                  requestAnimationFrame(() =>
                    window.dispatchEvent(
                      new CustomEvent("session-reveal-project", {
                        detail: cwd,
                      }),
                    ),
                  );
                }}
              >
                <LocateFixed size={14} />
                在列表中定位当前项目
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(cwd).catch(() =>
                    toast({
                      title: "复制失败",
                      description: "请从项目菜单中选择并复制完整路径。",
                      variant: "destructive",
                    }),
                  );
                }}
              >
                <Copy size={14} />
                复制项目路径
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
