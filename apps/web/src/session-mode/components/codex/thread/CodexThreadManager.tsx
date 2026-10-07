import { useSessionNameStore } from "../../../stores/useSessionNameStore";
import { useShallow } from "zustand/react/shallow";
import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Thread, ThreadListParams } from "@session/bindings/v2";
import {
  useCodexStore,
  useThreadListStore,
} from "@session/components/codex/stores";
import {
  DeleteConfirmDialog,
  Toolbar,
} from "@session/components/common/SessionManagerShared";
import { Button } from "@session/components/ui/button";
import { Checkbox } from "@session/components/ui/checkbox";
import { ScrollArea } from "@session/components/ui/scroll-area";
import { useToast } from "@session/components/ui/use-toast";
import { deleteFile, listThreads } from "@session/services/apiAdapt";
import { codexService } from "@session/services/codexService";
import { useAgentCenterStore, useLayoutStore } from "@session/stores";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { formatThreadAge } from "@session/utils/formatThreadAge";
import { getFilename } from "@session/utils/getFilename";
import { modelProviders } from "../constants";

interface CodexThreadManagerProps {
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function CodexThreadManager({ onClose }: CodexThreadManagerProps) {
  // This manager keeps its own thread list (fetched directly via listThreads)
  // instead of reading from useCodexStore, since that store only tracks the
  // globally-loaded/active thread set. currentThreadId is still read from the
  // store since it's needed to know which thread to reset when deleting.
  const { currentThreadId } = useCodexStore(
    useShallow((s) => ({ currentThreadId: s.currentThreadId })),
  );
  const { sortKey } = useThreadListStore();
  const { cwd, setCwd } = useWorkspaceStore();
  const { setView } = useLayoutStore();
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const names = useSessionNameStore((s) => s.names);
  const nameOf = (thread: Thread) =>
    names[`codex:${thread.id}`] ?? thread.name ?? thread.preview ?? thread.id;
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const requestRef = useRef(0);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteItems, setPendingDeleteItems] = useState<Thread[] | null>(
    null,
  );
  const { toast } = useToast();

  // Local pagination state, independent from the global store.
  const [threads, setThreads] = useState<Thread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Separate flag for appending a page (infinite scroll) vs. replacing the
  // whole list, so the existing rows stay mounted while more load in.
  const [loadingMore, setLoadingMore] = useState(false);
  // Whether to filter by the current workspace cwd, or show threads from all cwds.
  const [scopeToCwd, setScopeToCwd] = useState(true);
  // Sentinel element at the bottom of the list; observed to auto-trigger
  // loading the next page instead of requiring a "Load more" click.
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const handleOpenThread = async (thread: Thread) => {
    const targetCwd = thread.cwd || cwd;
    if (targetCwd && targetCwd !== cwd) {
      setCwd(targetCwd);
    }
    addAgentCard({
      kind: "codex",
      id: thread.id,
      preview: thread.preview,
      cwd: targetCwd,
    });
    setCurrentAgentCardId(thread.id);
    setView("agent");
    onClose();
    await codexService.setCurrentThread(thread.id);
  };

  // Fetch a page of threads directly via listThreads, optionally
  // scoped to the current workspace cwd. Resets the list unless appending.
  const fetchThreads = useCallback(
    async (cursor: string | null, append: boolean) => {
      const request = append ? requestRef.current : ++requestRef.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadingMore(false);
      }
      append ? setPageError(null) : setError(null);
      try {
        const params: ThreadListParams = {
          cursor,
          limit: PAGE_SIZE,
          modelProviders: modelProviders,
          archived: false,
          sortKey,
          cwd: scopeToCwd ? cwd : null,
          useStateDbOnly: true,
        };
        const response = await listThreads(params);
        if (request !== requestRef.current) return;
        setThreads((prev) =>
          append
            ? [
                ...prev,
                ...response.data.filter(
                  (thread) =>
                    !prev.some((existing) => existing.id === thread.id),
                ),
              ]
            : response.data,
        );
        setNextCursor(response.nextCursor ?? null);
      } catch (error) {
        if (request !== requestRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        append ? setPageError(message) : setError(message);
      } finally {
        if (request === requestRef.current) {
          append ? setLoadingMore(false) : setLoading(false);
        }
      }
    },
    [cwd, sortKey, scopeToCwd],
  );

  // Reload from the first page whenever cwd scope or sort changes.
  useEffect(() => {
    void fetchThreads(null, false);
    return () => {
      requestRef.current++;
    };
  }, [fetchThreads]);

  // Infinite scroll: observe a sentinel at the bottom of the list and load
  // the next page automatically when it comes into view, so new rows appear
  // right where the user is already looking instead of requiring a manual
  // "Load more" click followed by more scrolling.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || pageError) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          nextCursor &&
          !loading &&
          !loadingMore
        ) {
          void fetchThreads(nextCursor, true);
        }
      },
      {
        root: sentinel.closest("[data-radix-scroll-area-viewport]"),
        rootMargin: "80px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loading, loadingMore, pageError, fetchThreads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        (names[`codex:${t.id}`] ?? t.name ?? t.preview ?? t.id)
          .toLowerCase()
          .includes(q) ||
        (t.preview ?? "").toLowerCase().includes(q) ||
        (t.cwd ?? "").toLowerCase().includes(q),
    );
  }, [threads, search, names]);

  const allSelected =
    filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const doDelete = async (items: Thread[]) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    const deletedIds = new Set<string>();
    let failed = 0;
    for (const item of items) {
      if (!item.path) {
        failed++;
        continue;
      }
      try {
        await deleteFile(item.path);
        deletedIds.add(item.id);
        if (currentThreadId === item.id) {
          await codexService.setCurrentThread(null);
        }
      } catch {
        failed++;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of deletedIds) next.delete(id);
      return next;
    });
    setThreads((prev) => prev.filter((t) => !deletedIds.has(t.id)));
    // Refresh global thread list so sidebar (which still reads useCodexStore) updates.
    try {
      await codexService.loadThreads(cwd, false, sortKey);
    } catch {
      toast({
        description: "会话列表刷新失败，请重新加载",
        variant: "destructive",
      });
    }
    deletingRef.current = false;
    setDeleting(false);
    if (failed > 0) {
      toast({
        description: `有 ${failed} 个会话未能删除，已保留，可重试`,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Toolbar
        search={search}
        onSearch={setSearch}
        selectedCount={selectedIds.size}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onDeleteSelected={() => {
          const items = threads.filter((t) => selectedIds.has(t.id));
          setPendingDeleteItems(items);
        }}
      />

      {deleting && (
        <p role="status" className="text-xs text-muted-foreground py-1">
          正在删除会话记录…
        </p>
      )}
      <div className="flex items-center gap-2 px-1 py-1 text-xs">
        <Button
          variant={scopeToCwd ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setScopeToCwd(true)}
        >
          当前项目
        </Button>
        <Button
          variant={!scopeToCwd ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setScopeToCwd(false)}
        >
          所有项目
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 mt-2">
        {error && (
          <div role="alert" className="p-3 text-sm text-destructive">
            <p>会话加载失败：{error}</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void fetchThreads(null, false)}
            >
              重试
            </Button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8 animate-in fade-in duration-150">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载会话…
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="text-sm text-muted-foreground py-8 text-center animate-in fade-in duration-200">
            {search.trim() ? "没有匹配的会话" : "该范围还没有会话"}
          </div>
        ) : (
          filtered.map((thread) => (
            <div
              key={thread.id}
              role="button"
              tabIndex={0}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/40 group/session-row cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              onClick={() => void handleOpenThread(thread)}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  void handleOpenThread(thread);
                }
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: not a control — it only stops the row's click from reaching the parent */}
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <Checkbox
                  aria-label={`选择 ${nameOf(thread)}`}
                  checked={selectedIds.has(thread.id)}
                  onCheckedChange={() => toggle(thread.id)}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {nameOf(thread)}
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground truncate">
                  <span>{getFilename(thread.cwd) || thread.cwd}</span>
                  {formatThreadAge(thread.createdAt ?? 0)}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除 ${nameOf(thread)}`}
                    disabled={deleting}
                    className="h-8 w-8 opacity-0 group-hover/session-row:opacity-100 group-focus-within/session-row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-destructive shrink-0 transition-opacity duration-150"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteItems([thread]);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
        {/* Sentinel for infinite scroll — triggers loading the next page when
            it scrolls into view. Shows an inline spinner while fetching so
            new rows appear right where the user is looking. */}
        {pageError && (
          <div role="alert" className="p-2 text-xs text-destructive">
            更多会话加载失败：{pageError}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void fetchThreads(nextCursor, true)}
            >
              重试加载更多
            </Button>
          </div>
        )}
        {!loading && nextCursor && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
          >
            {loadingMore && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在加载更多…
              </>
            )}
          </div>
        )}
      </ScrollArea>

      <DeleteConfirmDialog
        open={!!pendingDeleteItems}
        count={pendingDeleteItems?.length ?? 0}
        onCancel={() => setPendingDeleteItems(null)}
        onConfirm={() => {
          if (pendingDeleteItems && !deletingRef.current) {
            void doDelete(pendingDeleteItems);
            setPendingDeleteItems(null);
          }
        }}
      />
    </>
  );
}
