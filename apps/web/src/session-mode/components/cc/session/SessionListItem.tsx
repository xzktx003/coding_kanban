import { SessionRowMenu } from "../../common/SessionRowMenu";
import { SessionRowTitle } from "../../common/SessionRowTitle";
import { SessionAgentBadge } from "../../common/SessionAgentBadge";
import { SessionStatus, UnreadDot } from "../../common/SessionStatus";
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
      <div className="session-nav-title">
        <SessionAgentBadge kind="cc" />
        <SessionRowTitle title={name} detail={`Claude Code · ${formatThreadAge(Math.floor(session.last_modified / 1000))}`} />
        <SessionStatus kind="cc" id={session.session_id} compact />
      </div>

      <div className="session-nav-meta">
        <span className="session-nav-age">
          {formatThreadAge(Math.floor(session.last_modified / 1000))}
        </span>
        <SessionRowMenu rename={{ kind: "cc", id: session.session_id, title: name }}>
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
        </SessionRowMenu>
      </div>
    </div>
  );
}
