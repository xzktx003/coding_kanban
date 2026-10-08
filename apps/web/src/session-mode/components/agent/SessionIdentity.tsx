import { useRef } from "react";
import { Copy, Folder, LocateFixed } from "lucide-react";
import { SessionAgentBadge } from "../common/SessionAgentBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { toast } from "../ui/use-toast";
import {
  useAgentCenterStore,
  type AgentCenterCard,
} from "../../stores/useAgentCenterStore";
import { sessionProject } from "../../utils/sessionProject";

export function useSessionProject(
  card: Pick<AgentCenterCard, "cwd" | "worktreePath">,
) {
  const cards = useAgentCenterStore((s) => s.cards);
  const detached = useAgentCenterStore((s) => s.detachedCard);
  return sessionProject(card, detached ? [...cards, detached] : cards);
}
export function SessionIdentityTitle({
  kind,
  title,
}: {
  kind: AgentCenterCard["kind"] | "acp";
  title: string;
}) {
  return (
    <>
      <SessionAgentBadge kind={kind} />
      <span className="session-identity-title" title={title}>
        {title}
      </span>
    </>
  );
}
export function SessionProjectLabel({
  card,
  id,
}: {
  card: Pick<AgentCenterCard, "cwd" | "worktreePath">;
  id?: string;
}) {
  const project = useSessionProject(card);
  const revealOnClose = useRef(false);
  return (
    <span
      className="session-project-detail"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            id={id}
            className="session-identity-project"
            aria-label={`项目详情：${project.label}`}
            title={project.path || "这条会话尚无项目目录"}
          >
            <Folder size={11} aria-hidden="true" />
            <span>{project.label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="session-project-details-menu"
          onCloseAutoFocus={(event) => {
            if (!revealOnClose.current) return;
            event.preventDefault();
            revealOnClose.current = false;
            window.dispatchEvent(new Event("session-open-projects"));
            requestAnimationFrame(() =>
              window.dispatchEvent(
                new CustomEvent("session-reveal-project", {
                  detail: project.projectPath || project.path,
                }),
              ),
            );
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenuLabel className="session-project-full-path">
            {project.path || "项目未知：这条会话尚无项目目录，请先确认项目。"}
          </DropdownMenuLabel>
          {project.path && (
            <>
              {project.projectPath && project.path !== project.projectPath && (
                <DropdownMenuLabel className="session-project-full-path">
                  所属项目：{project.projectPath}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  revealOnClose.current = true;
                }}
              >
                <LocateFixed size={14} />
                在侧栏定位项目
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void Promise.resolve()
                    .then(() => navigator.clipboard.writeText(project.path!))
                    .catch(() =>
                      toast({
                        title: "复制失败",
                        description: "请从项目详情中选择并复制完整路径。",
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
    </span>
  );
}
