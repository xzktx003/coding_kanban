import { SessionStatus } from "../../common/SessionStatus";
import { SessionAgentBadge } from "../../common/SessionAgentBadge";
import { useSessionNameStore } from "../../../stores/useSessionNameStore";
import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DeleteConfirmDialog,
  Toolbar,
} from "@session/components/common/SessionManagerShared";
import { Button } from "@session/components/ui/button";
import { Checkbox } from "@session/components/ui/checkbox";
import { ScrollArea } from "@session/components/ui/scroll-area";
import { useToast } from "@session/components/ui/use-toast";
import { listSessions, type SdkSessionInfo } from "@session/lib/sessions";
import { ccDeleteSession } from "@session/services/apiAdapt/cc";
import { useAgentCenterStore, useLayoutStore } from "@session/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { formatThreadAge } from "@session/utils/formatThreadAge";
import { getFilename } from "@session/utils/getFilename";

interface CCSessionManagerProps {
  open: boolean;
  onClose: () => void;
}

export function CCSessionManager({ open, onClose }: CCSessionManagerProps) {
  const names = useSessionNameStore((s) => s.names);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const requestRef = useRef(0);
  const [sessions, setSessions] = useState<SdkSessionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  const { toast } = useToast();
  const { cwd, setCwd } = useWorkspaceStore();
  const { setSelectedAgent } = useAgentSettingsStore();
  const { setView } = useLayoutStore();
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();

  const PAGE_SIZE = 20;

  const handleOpenSession = (session: SdkSessionInfo) => {
    if (session.cwd && session.cwd !== cwd) {
      setCwd(session.cwd);
    }
    setSelectedAgent("cc");
    addAgentCard({
      kind: "cc",
      id: session.session_id,
      preview: session.summary,
      cwd: session.cwd || cwd,
    });
    setCurrentAgentCardId(session.session_id);
    setView("agent");
    onClose();
  };

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listSessions(undefined, {
        limit: PAGE_SIZE,
        offset,
        includeWorktrees: true,
      });
      if (request !== requestRef.current) return;
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (e) {
      if (request === requestRef.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [offset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: search is the trigger for the debounced filter
  useEffect(() => {
    if (!open) return;
    void load();
    return () => {
      requestRef.current++;
    };
  }, [load, open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: search is the trigger for the debounced filter
  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (names[`cc:${s.session_id}`] ?? s.summary).toLowerCase().includes(q) ||
        (s.cwd ?? "").toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q),
    );
  }, [sessions, search, names]);

  const allSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.has(s.session_id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.session_id)));
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const doDelete = async (ids: string[]) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    const deletedIds = new Set<string>();
    let failed = 0;
    for (const id of ids) {
      try {
        await ccDeleteSession(id);
        deletedIds.add(id);
      } catch {
        failed++;
      }
    }
    setSessions((prev) => prev.filter((s) => !deletedIds.has(s.session_id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of deletedIds) next.delete(id);
      return next;
    });
    setTotal((prev) => Math.max(0, prev - deletedIds.size));
    deletingRef.current = false;
    setDeleting(false);
    if (failed > 0) {
      toast({
        description: `有 ${failed} 个会话未能删除，已保留，可重试`,
        variant: "destructive",
      });
    }
  };

  if (loading && sessions.length === 0) {
    return (
      <div
        role="status"
        className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        正在加载会话…
      </div>
    );
  }

  return (
    <>
      <Toolbar
        search={search}
        onSearch={setSearch}
        selectedCount={selectedIds.size}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onDeleteSelected={() => setPendingDeleteIds(Array.from(selectedIds))}
      />

      {deleting && (
        <p role="status" className="py-1 text-xs text-muted-foreground">
          正在删除会话记录…
        </p>
      )}
      {error && (
        <div role="alert" className="py-2 text-sm text-destructive">
          <p>会话加载失败：{error}</p>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}
      <ScrollArea
        className="flex-1 min-h-0 mt-2"
        aria-busy={loading || undefined}
      >
        {filtered.length === 0 && !error ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {search.trim() ? "当前页没有匹配的会话" : "还没有 Claude 会话"}
          </div>
        ) : (
          filtered.map((session) => (
            <div
              key={session.session_id}
              role="button"
              tabIndex={0}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/40 group/session-row cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleOpenSession(session)}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  handleOpenSession(session);
                }
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: not a control — it only stops the row's click from reaching the parent */}
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <Checkbox
                  aria-label={`选择 ${names[`cc:${session.session_id}`] ?? session.summary}`}
                  checked={selectedIds.has(session.session_id)}
                  onCheckedChange={() => toggle(session.session_id)}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <SessionAgentBadge kind="cc" />
                  <span className="truncate">
                    {names[`cc:${session.session_id}`] ??
                      (session.summary || session.session_id)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {getFilename(session.cwd ?? "") ||
                    session.cwd ||
                    "未关联项目"}
                </div>
              </div>
              <SessionStatus kind="cc" id={session.session_id} compact />
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 max-sm:hidden">
                {formatThreadAge(Math.floor(session.last_modified / 1000))}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`删除 ${names[`cc:${session.session_id}`] ?? session.summary}`}
                disabled={deleting}
                className="h-8 w-8 opacity-0 group-hover/session-row:opacity-100 group-focus-within/session-row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDeleteIds([session.session_id]);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </ScrollArea>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>所有项目{search.trim() ? " · 搜索当前页" : ""}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          >
            上一页
          </Button>
          <span>
            {filtered.length ? offset + 1 : 0}–
            {filtered.length ? offset + filtered.length : 0} / {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={loading || offset + PAGE_SIZE >= total}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      </div>

      <DeleteConfirmDialog
        open={!!pendingDeleteIds}
        count={pendingDeleteIds?.length ?? 0}
        onCancel={() => setPendingDeleteIds(null)}
        onConfirm={() => {
          if (pendingDeleteIds && !deletingRef.current) {
            void doDelete(pendingDeleteIds);
            setPendingDeleteIds(null);
          }
        }}
      />
    </>
  );
}
