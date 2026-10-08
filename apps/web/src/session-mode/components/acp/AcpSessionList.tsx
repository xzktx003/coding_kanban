import { SessionRowMenu } from "../common/SessionRowMenu";
import { SessionRowTitle } from "../common/SessionRowTitle";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { SessionAgentBadge } from "../common/SessionAgentBadge";
import { SessionStatus } from "../common/SessionStatus";
import { useSessionNameStore } from "../../stores/useSessionNameStore";
import { Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@session/components/ui/alert-dialog";
import { useAcpStore } from "@session/stores/useAcpStore";
import type { AcpSessionRecord } from "@session/services/apiAdapt/acp";
import { formatThreadAge } from "@session/utils/formatThreadAge";
import { useAcpSessions } from "./useAcpSessions";

/** Sidebar list of persisted ACP sessions for one project. */
export function AcpSessionList({ directory }: { directory: string }) {
  const names = useSessionNameStore((s) => s.names);
  const { sessions, opening, loading, error, refresh, open, remove } =
    useAcpSessions(directory);
  const sessionId = useAcpStore((s) => s.sessionId);
  const [pendingDelete, setPendingDelete] = useState<AcpSessionRecord | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const title = (session: AcpSessionRecord) =>
    names[`acp:${session.agentId}:${session.sessionId}`] ??
    session.title ??
    "新会话";
  const confirmDelete = async () => {
    if (!pendingDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove(pendingDelete);
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };
  return (
    <div className="px-2 py-1 space-y-0.5" aria-busy={loading || undefined}>
      {loading && sessions.length === 0 && (
        <div
          role="status"
          className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          正在加载会话…
        </div>
      )}
      {error && (
        <div role="alert" className="px-2 py-2 text-xs text-destructive">
          <p>会话加载失败：{error}</p>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground">
          该项目还没有 ACP 会话。
        </div>
      )}
      {sessions.map((session) => (
        <div
          key={session.sessionId}
          role="button"
          tabIndex={0}
          onClick={() => void open(session)}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              void open(session);
            }
          }}
          aria-current={session.sessionId === sessionId ? "true" : undefined}
          className={`session-nav-row group/session-row relative flex items-center gap-2 w-full text-left p-2 rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${session.sessionId === sessionId ? "bg-accent" : "hover:bg-accent/50"}`}
        >
          <div className="session-nav-title">
            <SessionAgentBadge kind="acp" agentName={session.agentTitle ?? session.agentId} />
            <SessionRowTitle title={title(session)} detail={`ACP · ${session.agentTitle ?? session.agentId}`} />
            {opening === session.sessionId ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> :
              <SessionStatus kind="acp" id={`${session.agentId}:${session.sessionId}`} compact />}
          </div>
          <div className="session-nav-meta">
            <span className="session-nav-age">
              {formatThreadAge(Math.floor(new Date(session.updatedAt).getTime() / 1000))}
            </span>
          <SessionRowMenu rename={{ kind: "acp", id: `${session.agentId}:${session.sessionId}`, title: title(session) }}>
            <DropdownMenuItem variant="destructive" onSelect={() => { setPendingDelete(session); setDeleteError(null); }}>
              <Trash2 className="size-3.5" />删除会话记录
            </DropdownMenuItem>
          </SessionRowMenu>
          </div>
        </div>
      ))}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(value) => {
          if (!value && !deletingRef.current) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除“{pendingDelete ? title(pendingDelete) : ""}
              ”的历史记录。
              {pendingDelete?.sessionId === sessionId
                ? "这是当前会话，删除后会创建新会话，必要时重新连接 Agent。"
                : "此操作无法撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              删除失败：{deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "正在删除…" : "删除记录"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
