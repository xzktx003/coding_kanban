// Handles fetching and paginating the session list for a directory.
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isDesktopTauri } from '@session/hooks/runtime';
import { listSessions, type SdkSessionInfo } from '@session/lib/sessions';

type AutomationRunStartedPayload = {
  agent?: string;
  taskName: string;
  threadId: string;
  startedAt: string;
  cwd?: string | null;
};

export const DEFAULT_VISIBLE = 3;
export const LOAD_MORE_SIZE = 20;

interface UseSessionPaginationArgs {
  directory: string;
  sessions?: SdkSessionInfo[];
}

export function useSessionPagination({ directory, sessions }: UseSessionPaginationArgs) {
  const [loadedSessions, setLoadedSessions] = useState<SdkSessionInfo[]>([]);
  const [loading, setLoading] = useState(sessions === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const controlled = sessions !== undefined;
  const generation = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    generation.current++; pending.current = null;
    setExpanded(false); setLoadingMore(false); setPageError(null);
    return () => { generation.current++; pending.current = null; };
  }, [directory, controlled]);
  const [totalCount, setTotalCount] = useState(0);

  // Sync loading/error state when sessions prop changes (controlled mode)
  if (sessions !== undefined && (loading || error)) {
    setLoading(false);
    setError(null);
  }

  // Initial load: fetch the first page of sessions when running in
  // uncontrolled mode (no `sessions` prop supplied by the parent).
  useEffect(() => {
    if (sessions !== undefined) return;
    if (!directory) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { sessions: initial, total } = await listSessions(directory, {
          limit: LOAD_MORE_SIZE,
          offset: 0,
          includeWorktrees: true,
        });
        if (cancelled) return;
        setLoadedSessions(initial);
        setTotalCount(total);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [directory, sessions]);

  // An automation cc run creates a real CLI session in the backend. Show it right away
  // instead of waiting for the next full reload of this directory's list.
  useEffect(() => {
    if (sessions !== undefined || !directory || !isDesktopTauri()) return;
    const unlistenPromise = listen<AutomationRunStartedPayload>(
      'automation:run/started',
      (event) => {
        const { agent, threadId, taskName, cwd } = event.payload;
        if (agent !== 'cc' || cwd !== directory) return;
        setLoadedSessions((prev) => {
          if (prev.some((s) => s.session_id === threadId)) return prev;
          return [
            {
              session_id: threadId,
              summary: taskName,
              last_modified: Date.now(),
              cwd,
            },
            ...prev,
          ];
        });
        setTotalCount((prev) => prev + 1);
      }
    );
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [directory, sessions]);

  const loadMoreSessions = useCallback(async () => {
    // First reveal the rows already fetched (or supplied by the parent).
    if (!expanded || sessions !== undefined) { setExpanded(true); return; }
    if (!directory || pending.current === generation.current) return;
    const request = generation.current;
    pending.current = request;
    setLoadingMore(true); setPageError(null);
    try {
      const { sessions: extra, total } = await listSessions(directory, {
        limit: LOAD_MORE_SIZE, offset: loadedSessions.length, includeWorktrees: true,
      });
      if (generation.current !== request) return;
      setLoadedSessions(prev => {
        const ids = new Set(prev.map(s => s.session_id));
        return [...prev, ...extra.filter(s => !ids.has(s.session_id))];
      });
      setTotalCount(total);
    } catch (err) {
      if (generation.current === request) setPageError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (generation.current === request) { pending.current = null; setLoadingMore(false); }
    }
  }, [directory, sessions, expanded, loadedSessions.length]);

  const removeSession = useCallback((sessionId: string) => {
    setLoadedSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  return {
    loadedSessions,
    loading,
    loadingMore,
    pageError,
    error,
    expanded,
    setExpanded,
    totalCount,
    loadMoreSessions,
    removeSession,
  };
}
