import { SessionAgentBadge } from "../../common/SessionAgentBadge";
import { SessionStatus, UnreadDot } from "../../common/SessionStatus";
import { RenameSessionButton } from "../../common/RenameSessionButton";
import { useSessionName } from "../../../stores/useSessionNameStore";
// Single row in the SessionList, including the action dropdown menu.
import {
  Copy,
  FolderX,
  Loader2,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import type { SdkSessionInfo } from "@session/lib/sessions";
import { usePinStore } from "@session/stores/usePinStore";
import { formatThreadAge } from "@session/utils/formatThreadAge";

interface SessionListItemProps {
  session: SdkSessionInfo;
  isSelected: boolean;
  isActive: boolean;
  isLoading: boolean;
  onSelect: (session: SdkSessionInfo) => void;
  onCopyId: (e: React.MouseEvent, id: string) => void;
  onDeleteWorktree: (session: SdkSessionInfo) => void;
  onRequestDelete: (sessionId: string) => void;
}

export function SessionListItem({
  session,
  isSelected,
  isActive,
  isLoading,
  onSelect,
  onCopyId,
  onDeleteWorktree,
  onRequestDelete,
}: SessionListItemProps) {
  const name = useSessionName("cc", session.session_id, session.summary);
  const isWorktree = (session.cwd ?? "").includes("/.codexia/worktrees/");
  const pinned = usePinStore((s) => s.pinned);
  const togglePin = usePinStore((s) => s.togglePin);
  const isPinned = pinned.some((p) => p.id === session.session_id);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-nav-row group/session-row relative grid grid-cols-[1fr_auto] items-center gap-3 w-full text-left p-2 rounded-lg transition-colors cursor-pointer ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
      onClick={() => onSelect(session)}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onSelect(session);
        }
      }}
      aria-current={isSelected ? "true" : undefined}
    >
      <div
        className={`flex items-center gap-1.5 text-sm font-medium min-w-0 ${isSelected ? "text-primary" : "text-inherit"}`}
      >
        <SessionAgentBadge kind="cc" />
        <span className="session-row-title min-w-0 truncate" title={name}>
          {name}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
        <SessionStatus kind="cc" id={session.session_id} compact />
        <span className="group-hover/session-row:hidden max-md:hidden">
          {formatThreadAge(Math.floor(session.last_modified / 1000))}
        </span>
        <RenameSessionButton
          kind="cc"
          id={session.session_id}
          title={name}
          className="opacity-0 group-hover/session-row:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded hover:bg-accent/50 transition-colors text-muted-foreground opacity-0 group-hover/session-row:opacity-100 group-focus-within/session-row:opacity-100 max-md:opacity-100"
              aria-label="会话操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => onCopyId(e, session.session_id)}>
              <Copy className="h-3 w-3" />
              <span>复制会话 ID</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                togglePin({
                  kind: "cc",
                  id: session.session_id,
                  title: session.summary,
                  cwd: session.cwd ?? "",
                });
              }}
            >
              {isPinned ? (
                <PinOff className="h-3 w-3" />
              ) : (
                <Pin className="h-3 w-3" />
              )}
              <span>{isPinned ? "取消置顶" : "置顶"}</span>
            </DropdownMenuItem>
            {isWorktree && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteWorktree(session);
                }}
              >
                <FolderX className="h-3 w-3" />
                <span>删除工作树</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(session.session_id);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              <span>删除记录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
