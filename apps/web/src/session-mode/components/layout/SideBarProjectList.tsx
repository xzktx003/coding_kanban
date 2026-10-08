import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FolderClosed,
  FolderOpen,
  ScrollText,
  SquarePen,
  X,
} from "lucide-react";
import { Button } from "@session/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@session/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { isPhone } from "@session/hooks/runtime";
import { useLayoutStore } from "@session/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { getFilename } from "@session/utils/getFilename";

type Props = {
  onNewAction: (project: string) => void;
  newActionTitle: (projectName: string) => string;
  renderList: (project: string) => React.ReactNode;
};

export function SideBarProjectList({
  onNewAction,
  newActionTitle,
  renderList,
}: Props) {
  const { projects, removeProject, setCwd, projectSyncError } =
    useWorkspaceStore();
  const { setInstructionType } = useAgentSettingsStore();
  const { setView, expandedProjects, setProjectExpanded } = useLayoutStore();

  const isOpen = (project: string) => expandedProjects[project] ?? true;
  const toggleProject = (project: string, open: boolean) =>
    setProjectExpanded(project, open);

  const openAgentInstructions = (project: string) => {
    setCwd(project);
    setView("agents-md");
    setInstructionType("project");
  };

  return (
    <div className="flex min-h-0 w-full flex-col gap-2 px-2 pb-2">
      {projectSyncError && (
        <p
          role="status"
          className="px-1 text-xs text-muted-foreground"
          title={projectSyncError}
        >
          项目同步待重试
        </p>
      )}
      {projects.map((project) => (
        <Collapsible
          key={project}
          data-project-path={project}
          open={isOpen(project)}
          onOpenChange={(open) => toggleProject(project, open)}
          className="session-project-group"
        >
          <div
            className="session-project-heading"
            title={project}
          >
            <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {isOpen(project) ? (
                <FolderOpen
                  className={`h-3.5 w-3.5 shrink-0 transition-transform`}
                />
              ) : (
                <FolderClosed
                  className={`h-3.5 w-3.5 shrink-0 transition-transform`}
                />
              )}
              <span className="truncate font-medium">
                {getFilename(project) || project}
              </span>
              {isOpen(project) ? (
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-opacity `}
                />
              ) : (
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 transition-opacity `}
                />
              )}
            </CollapsibleTrigger>

            {/* Remove/Instructions edit the desktop's own project list, so a
                phone — which only mirrors it — does not offer them. */}
            {!isPhone() && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={`项目操作：${getFilename(project) || project}`}
                    aria-label={`项目操作：${getFilename(project) || project}`}
                    className="session-project-action shrink-0"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => removeProject(project)}>
                    <X /> 从项目列表移除
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openAgentInstructions(project)}
                  >
                    <ScrollText /> 项目指令
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="ghost"
              size="icon-xs"
              title={newActionTitle(getFilename(project) || project)}
              onClick={() => onNewAction(project)}
              className="session-project-action shrink-0"
            >
              <SquarePen />
            </Button>
          </div>

          <CollapsibleContent className="session-project-sessions">{renderList(project)}</CollapsibleContent>
        </Collapsible>
      ))}

      {/* The phone's home screen says this itself, with a retry. */}
      {projects.length === 0 && !isPhone() && (
        <div className="rounded-lg border border-sidebar-border bg-sidebar/30 px-3 py-3 text-xs text-muted-foreground">
          还没有项目。
        </div>
      )}
    </div>
  );
}
