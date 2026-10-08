import { subagentParent } from "@agent-orchestrator/shared";
import { useSubagentStore } from "@session/features/subagents/store";
import { SessionRowMenu } from "../../common/SessionRowMenu";
import { SessionRowTitle } from "../../common/SessionRowTitle";
import { SessionLoadMore } from "../../common/SessionLoadMore";
import { DropdownMenuItem, DropdownMenuSeparator } from "../../ui/dropdown-menu";
import { SessionAgentBadge } from "../../common/SessionAgentBadge";
import { SessionStatus, UnreadDot } from "../../common/SessionStatus";
import { useSessionNameStore } from "../../../stores/useSessionNameStore";
import { renameSession } from "../../../services/sessionNames";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import type { LucideIcon } from "lucide-react";
import { Archive, FolderX, GitFork, Loader2, Pin, PinOff } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type {
  Thread,
  ThreadListParams,
  ThreadListResponse,
  ThreadNameUpdatedNotification,
} from "@session/bindings/v2";
import {
  useCodexStore,
  useConfigStore,
  useThreadListStore,
} from "@session/components/codex/stores";
import { RenameThreadDialog } from "@session/components/codex/thread/RenameThreadDialog";
import { Button } from "@session/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@session/components/ui/context-menu";
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
import { toast } from "@session/components/ui/use-toast";
import { isDesktopTauri } from "@session/hooks/runtime";
import {
  archiveThread,
  deleteThread,
  listThreads,
} from "@session/services/apiAdapt";
import { gitRemoveWorktree } from "@session/services/apiAdapt/git";
import { codexService } from "@session/services/codexService";
import { useAgentCenterStore, useLayoutStore } from "@session/stores";
import { usePinStore } from "@session/stores/usePinStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { formatThreadAge } from "@session/utils/formatThreadAge";

interface ThreadListProps {
  cwd: string;
}

interface ThreadAction {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

const EMPTY_LIST: ThreadListResponse = {
  data: [],
  nextCursor: null,
  backwardsCursor: null,
};

const PAGE_SIZE = 3;

export function ThreadList({ cwd }: ThreadListProps) {
  const childNodes = useSubagentStore(s => s.nodes);
  const names = useSessionNameStore((s) => s.names);
  const { cwd: workspaceCwd, setCwd } = useWorkspaceStore();
  const { setView } = useLayoutStore();
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const {
    currentThreadId,
    threadStatusMap,
    threads: storeThreads,
  } = useCodexStore(
    useShallow((s) => ({
      currentThreadId: s.currentThreadId,
      threadStatusMap: s.threadStatusMap,
      threads: s.threads,
    })),
  );
  const { sortKey } = useThreadListStore();
  const pinnedIds = usePinStore((s) => s.pinned);
  const togglePin = usePinStore((s) => s.togglePin);
  const modelProvider = useConfigStore((s) => s.modelProvider);
  const [response, setResponse] = useState<ThreadListResponse>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string>();
  const renamePendingRef = useRef(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [pressedThreadId, setPressedThreadId] = useState<string | null>(null);

  const nextCursor = response.nextCursor;
  const requestRef = useRef(0);

  useEffect(() => {
    setResponse(EMPTY_LIST);
  }, [cwd, modelProvider]);

  // A freshly started thread is not in the state DB yet, so the backend list
  // does not return it. Merge in live threads from the store so it shows up
  // immediately; the DB row takes over on the next reload.
  const threads = useMemo(() => {
    const seen = new Set(response.data.map((t) => t.id));
    const live = storeThreads.filter(
      (t) =>
        !childNodes[t.id] && !subagentParent(t) && t.cwd === cwd && t.modelProvider === modelProvider && !seen.has(t.id),
    );
    if (live.length === 0) return response.data;
    const key = sortKey === "created_at" ? "createdAt" : "updatedAt";
    return [...live, ...response.data].sort((a, b) => b[key] - a[key]);
  }, [response.data, storeThreads, cwd, modelProvider, sortKey, childNodes]);

  // --- Thread loading (search + sort delegated to backend) ---

  // Only show threads of the provider currently selected in the composer.
  const providerFilter = useMemo(() => [modelProvider], [modelProvider]);

  // Keep however many threads are already visible when the list reloads
  // (select / delete / archive / fork) instead of collapsing back to one page.
  const loadedRef = useRef({ cwd, count: 0 });
  if (loadedRef.current.cwd !== cwd) loadedRef.current = { cwd, count: 0 };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCounter is the manual reload trigger
  useEffect(() => {
    let cancelled = false;
    ++requestRef.current;
    setIsLoadingMore(false);
    setPageError(null);
    const params: ThreadListParams = {
      limit: Math.max(PAGE_SIZE, loadedRef.current.count),
      sortKey,
      modelProviders: providerFilter,
      cwd,
      useStateDbOnly: true,
    };
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await listThreads(params);
        if (cancelled) return;
        loadedRef.current = { cwd, count: res.data.length };
        setResponse(res);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ++requestRef.current;
    };
  }, [cwd, sortKey, providerFilter, refreshCounter]);

  const refresh = useCallback(() => setRefreshCounter((n) => n + 1), []);

  // When a new thread is created in the store (e.g. after threadStart),
  // refresh the list so the sidebar reflects it immediately.
  const seenStoreIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const localIds = new Set(response.data.map((t) => t.id));
    const newIds = storeThreads
      .filter(
        (t) =>
          !childNodes[t.id] && !subagentParent(t) && t.cwd === cwd &&
          !localIds.has(t.id) &&
          !seenStoreIdsRef.current.has(t.id),
      )
      .map((t) => t.id);
    if (newIds.length === 0) return;
    for (const id of newIds) seenStoreIdsRef.current.add(id);
    refresh();
  }, [storeThreads, response.data, cwd, refresh, childNodes]);

  useEffect(() => {
    if (!isDesktopTauri()) return;

    const unlisten = listen<ServerNotification>(
      "codex:notification",
      (event) => {
        const { method, params } = event.payload;
        if (method !== "thread/name/updated") return;
        const { threadId, threadName } =
          params as ThreadNameUpdatedNotification;
        setResponse((prev) => ({
          ...prev,
          data: prev.data.map((t) =>
            t.id === threadId ? { ...t, name: threadName ?? null } : t,
          ),
        }));
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Remove successful archive/delete operations from navigation only. Transcript,
  // live execution and connection state remain owned by their existing stores.
  const removeFromNavigation = useCallback((threadId: string) => {
    useCodexStore.setState((state) => ({
      threads: state.threads.filter((thread) => thread.id !== threadId),
    }));
    setResponse((previous) => ({
      ...previous,
      data: previous.data.filter((thread) => thread.id !== threadId),
    }));
  }, []);

  // --- Thread actions ---

  const handleSelectThread = useCallback(
    async (threadId: string) => {
      if (threadId === currentThreadId) return;
      if (cwd !== workspaceCwd) setCwd(cwd);
      await codexService.setCurrentThread(threadId);
    },
    [currentThreadId, cwd, workspaceCwd, setCwd],
  );

  const handleOpenThread = useCallback(
    async (threadId: string, preview?: string) => {
      addAgentCard({ kind: "codex", id: threadId, preview, cwd });
      setCurrentAgentCardId(threadId);
      setView("agent");
      await handleSelectThread(threadId);
    },
    [handleSelectThread, setView, setCurrentAgentCardId, addAgentCard, cwd],
  );

  const handleArchive = useCallback(
    async (threadId: string) => {
      try {
        await archiveThread(threadId);
        removeFromNavigation(threadId);
      } catch (err) {
        toast.error("Failed to archive thread", { description: String(err) });
        return;
      }
      refresh();
    },
    [refresh, removeFromNavigation],
  );

  const handleFork = useCallback(
    async (threadId: string) => {
      let forked: Thread;
      try {
        forked = await codexService.threadFork(threadId);
      } catch (err) {
        toast.error("创建分支会话失败", { description: String(err) });
        return;
      }
      addAgentCard({
        kind: "codex",
        id: forked.id,
        preview: forked.name ?? forked.preview,
        cwd: forked.cwd || cwd,
      });
      setCurrentAgentCardId(forked.id);
      setView("agent");
      refresh();
    },
    [cwd, addAgentCard, setCurrentAgentCardId, setView, refresh],
  );

  const handleDeleteWorktree = useCallback(async (thread: Thread) => {
    const { cwd: mainCwd } = useWorkspaceStore.getState();
    if (!mainCwd || !thread.cwd.includes("/.codexia/worktrees/")) return;
    const key = thread.cwd.split("/").pop() ?? "";
    try {
      await gitRemoveWorktree(mainCwd, key);
      toast.success("Worktree deleted");
    } catch (err) {
      toast.error("Failed to delete worktree", { description: String(err) });
    }
  }, []);

  const handleDelete = useCallback(
    async (threadId: string) => {
      try {
        await deleteThread(threadId);
        removeFromNavigation(threadId);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : String(err));
        throw err;
      }
      if (currentThreadId === threadId) {
        await codexService.setCurrentThread(null);
      }
      refresh();
    },
    [currentThreadId, refresh, removeFromNavigation],
  );

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    const request = requestRef.current;
    setIsLoadingMore(true);
    setPageError(null);
    try {
      const params: ThreadListParams = {
        cursor: nextCursor,
        limit: 20,
        modelProviders: providerFilter,
        useStateDbOnly: true,
        sortKey,
        cwd,
      };
      const res = await listThreads(params);
      if (request !== requestRef.current) return;
      setResponse((prev) => {
        const seen = new Set(prev.data.map((t) => t.id));
        const data = [...prev.data, ...res.data.filter((t) => !seen.has(t.id))];
        loadedRef.current = { cwd, count: data.length };
        return { ...res, data };
      });
    } catch (error) {
      if (request === requestRef.current)
        setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === requestRef.current) setIsLoadingMore(false);
    }
  }, [cwd, isLoadingMore, nextCursor, sortKey, providerFilter]);

  const openRenameDialog = useCallback(
    (thread: Thread) => {
      // Prefer explicit name, fall back to preview (first message).
      setRenameThreadId(thread.id);
      setRenameValue(
        names[`codex:${thread.id}`] ?? thread.name ?? thread.preview,
      );
      setRenameError(undefined);
    },
    [names],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!renameThreadId || !renameValue.trim() || renamePendingRef.current)
      return;
    renamePendingRef.current = true;
    setRenameSaving(true);
    setRenameError(undefined);
    try {
      await renameSession("codex", renameThreadId, renameValue.trim());
      setRenameThreadId(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      renamePendingRef.current = false;
      setRenameSaving(false);
    }
  }, [renameThreadId, renameValue]);

  // --- Touch long press opens the context menu (touch devices get no
  // native contextmenu event, so synthesize one at the touch point) ---

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setPressedThreadId(null);
  }, []);

  const startLongPress = useCallback(
    (e: ReactPointerEvent, threadId: string) => {
      if (e.pointerType === "mouse") return;
      const target = e.currentTarget;
      const { clientX, clientY } = e;
      cancelLongPress();
      longPressFiredRef.current = false;
      setPressedThreadId(threadId);
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        setPressedThreadId(null);
        // The press may have started a native text selection that runs past
        // the row; drop it before opening the menu.
        window.getSelection()?.removeAllRanges();
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      }, 450);
    },
    [cancelLongPress],
  );

  useEffect(() => cancelLongPress, [cancelLongPress]);

  // Shared action list for the context menu.
  const threadActions = useCallback(
    (thread: Thread): ThreadAction[] => {
      const isPinned = pinnedIds.some((p) => p.id === thread.id);
      return [
        { label: "Rename", onSelect: () => openRenameDialog(thread) },
        {
          label: isPinned ? "Unpin" : "Pin",
          icon: isPinned ? PinOff : Pin,
          onSelect: () =>
            togglePin({
              kind: "codex",
              id: thread.id,
              title: thread.name ?? thread.preview,
              cwd: thread.cwd || cwd,
            }),
        },
        {
          label: "Fork",
          icon: GitFork,
          onSelect: () => void handleFork(thread.id),
        },
        {
          label: "Archive",
          icon: Archive,
          onSelect: () => void handleArchive(thread.id),
        },
        ...(thread.cwd.includes("/.codexia/worktrees/")
          ? [
              {
                label: "Delete Worktree",
                icon: FolderX,
                onSelect: () => void handleDeleteWorktree(thread),
              },
            ]
          : []),
        {
          label: "Delete",
          destructive: true,
          onSelect: () => {
            setPendingDelete(thread);
            setDeleteError(null);
          },
        },
        {
          label: "Copy Id",
          separatorBefore: true,
          onSelect: () => void navigator.clipboard.writeText(thread.id),
        },
      ];
    },
    [
      cwd,
      pinnedIds,
      togglePin,
      openRenameDialog,
      handleFork,
      handleArchive,
      handleDeleteWorktree,
      handleDelete,
    ],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none [-webkit-user-select:none] [-webkit-touch-callout:none]">
      <div className="min-h-0 flex-1" aria-busy={loading || undefined}>
        {loading && threads.length === 0 && (
          <div
            role="status"
            className="flex items-center gap-2 p-2 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3.5 animate-spin" />
            正在加载会话…
          </div>
        )}
        {loadError && (
          <div role="alert" className="p-2 text-xs text-destructive">
            <p>会话加载失败：{loadError}</p>
            <Button variant="ghost" size="sm" onClick={refresh}>
              重试
            </Button>
          </div>
        )}
        {threads.map((thread) => (
          <ContextMenu key={thread.id}>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => {
                  if (longPressFiredRef.current) {
                    longPressFiredRef.current = false;
                    return;
                  }
                  void handleOpenThread(thread.id, thread.preview);
                }}
                onPointerDown={(e) => startLongPress(e, thread.id)}
                onPointerUp={cancelLongPress}
                onPointerMove={cancelLongPress}
                onPointerCancel={cancelLongPress}
                role="button"
                tabIndex={0}
                aria-current={
                  currentThreadId === thread.id ? "true" : undefined
                }
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    void handleOpenThread(thread.id, thread.preview);
                  }
                }}
                className={`session-nav-row group/session-row grid grid-cols-[1fr_auto] items-center gap-2 w-full text-left p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-pan-y select-none [-webkit-user-select:none] [-webkit-touch-callout:none] ${
                  currentThreadId === thread.id
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                } ${
                  pressedThreadId === thread.id
                    ? "scale-[0.97] bg-accent/60 ring-1 ring-ring/60"
                    : "scale-100"
                }`}
              >
                <div className="session-nav-title">
                  <SessionAgentBadge kind="codex" />
                  <SessionRowTitle title={names[`codex:${thread.id}`] ?? thread.name ?? (thread.preview || "New chat")} detail={`Codex · ${formatThreadAge(thread.createdAt)}`} />
                  <SessionStatus kind="codex" id={thread.id} compact />
                </div>
                <div className="session-nav-meta">
                  <span className="session-nav-age">{formatThreadAge(thread.createdAt)}</span>
                  <SessionRowMenu>
                    {threadActions(thread).map(action => <Fragment key={action.label}>
                      {action.separatorBefore && <DropdownMenuSeparator />}
                      <DropdownMenuItem variant={action.destructive ? "destructive" : "default"} onSelect={action.onSelect}>
                        {action.icon && <action.icon className="size-3.5" />}{action.label}
                      </DropdownMenuItem>
                    </Fragment>)}
                  </SessionRowMenu>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              {threadActions(thread).map((action) => (
                <Fragment key={action.label}>
                  {action.separatorBefore && <ContextMenuSeparator />}
                  <ContextMenuItem
                    variant={action.destructive ? "destructive" : "default"}
                    onSelect={action.onSelect}
                  >
                    {action.icon && <action.icon className="mr-2 h-4 w-4" />}
                    {action.label}
                  </ContextMenuItem>
                </Fragment>
              ))}
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {!loading && !loadError && threads.length === 0 && (
          <div className="text-xs p-2 text-sidebar-foreground/50">
            该项目还没有会话。
          </div>
        )}
      </div>
      {pageError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          更多会话加载失败：{pageError}
        </p>
      )}
      {nextCursor && (
        <SessionLoadMore loading={isLoadingMore} error={Boolean(pageError)} onClick={handleLoadMore} />
      )}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deletingRef.current) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除“
              {pendingDelete
                ? (names[`codex:${pendingDelete.id}`] ??
                  pendingDelete.name ??
                  pendingDelete.preview)
                : ""}
              ”的历史记录，此操作无法撤销。
              {pendingDelete?.id === currentThreadId
                ? "当前会话视图也会关闭。"
                : ""}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDelete || deletingRef.current) return;
                deletingRef.current = true;
                setDeleting(true);
                setDeleteError(null);
                void handleDelete(pendingDelete.id)
                  .then(() => setPendingDelete(null))
                  .catch(() => {})
                  .finally(() => {
                    deletingRef.current = false;
                    setDeleting(false);
                  });
              }}
            >
              {deleting ? "正在删除…" : "删除记录"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RenameThreadDialog
        open={!!renameThreadId}
        onOpenChange={(open) => {
          if (!open && !renamePendingRef.current) setRenameThreadId(null);
        }}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        saving={renameSaving}
        error={renameError}
        handleRenameSubmit={handleRenameSubmit}
      />
    </div>
  );
}
