import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadSearchOccurrence } from "@session/bindings/v2/ThreadSearchOccurrence";
import { searchThreadOccurrences } from "./nativeSearch";

type SearchState = {
  key: string;
  data: ThreadSearchOccurrence[] | null;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  unsupported: boolean;
};
const empty = (key: string): SearchState => ({
  key,
  data: null,
  nextCursor: null,
  loading: false,
  error: null,
  unsupported: false,
});
export function useNativeThreadSearch(
  threadId: string,
  query: string,
  enabled: boolean,
  canSearch: () => boolean,
) {
  const key = JSON.stringify([threadId, query.trim()]);
  const [state, setState] = useState<SearchState>(() => empty(key));
  const stateRef = useRef(state);
  stateRef.current = state;
  const ownerRef = useRef({ key, enabled, canSearch });
  ownerRef.current = { key, enabled, canSearch };
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const revision = ++generation.current;
    controller.current?.abort();
    controller.current = null;
    setState(empty(key));
    if (!enabled || !query.trim() || !canSearch()) return;
    const capturedThread = threadId,
      capturedQuery = query.trim();
    const timer = setTimeout(() => {
      if (revision !== generation.current || !ownerRef.current.canSearch())
        return;
      const abort = new AbortController();
      controller.current = abort;
      setState({ ...empty(key), loading: true });
      void searchThreadOccurrences(
        { threadId: capturedThread, searchTerm: capturedQuery },
        abort.signal,
      ).then(
        (response) => {
          if (
            abort.signal.aborted ||
            generation.current !== revision ||
            ownerRef.current.key !== key ||
            !ownerRef.current.enabled
          )
            return;
          setState(
            response === null
              ? { ...empty(key), unsupported: true }
              : {
                  key,
                  data: response.data,
                  nextCursor: response.nextCursor,
                  loading: false,
                  error: null,
                  unsupported: false,
                },
          );
        },
        (error) => {
          if (
            abort.signal.aborted ||
            generation.current !== revision ||
            ownerRef.current.key !== key ||
            !ownerRef.current.enabled
          )
            return;
          setState({
            ...empty(key),
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
      ++generation.current;
    };
  }, [threadId, query, enabled, key]);
  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (
      !enabled ||
      current.key !== key ||
      current.loading ||
      !current.nextCursor ||
      !current.data ||
      !ownerRef.current.canSearch()
    )
      return;
    const capturedCursor = current.nextCursor;
    const revision = generation.current;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    stateRef.current = { ...current, loading: true, error: null };
    setState(stateRef.current);
    void searchThreadOccurrences(
      { threadId, searchTerm: query.trim(), cursor: capturedCursor },
      abort.signal,
    ).then(
      (response) => {
        if (
          abort.signal.aborted ||
          revision !== generation.current ||
          ownerRef.current.key !== key ||
          !ownerRef.current.enabled
        )
          return;
        if (response === null) {
          // A capability cannot quietly disappear halfway through an authoritative result set.
          setState({
            ...current,
            loading: false,
            error: "原生搜索能力在分页时不可用",
          });
          return;
        }
        if (response.nextCursor === capturedCursor) {
          setState({
            ...current,
            loading: false,
            error: "原生搜索返回了重复分页位置",
          });
          return;
        }
        setState({
          ...current,
          data: [...current.data!, ...response.data],
          nextCursor: response.nextCursor,
          loading: false,
          error: null,
        });
      },
      (error) => {
        if (
          abort.signal.aborted ||
          revision !== generation.current ||
          ownerRef.current.key !== key ||
          !ownerRef.current.enabled
        )
          return;
        setState({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }, [threadId, query, key, enabled]);
  return { ...(state.key === key && enabled ? state : empty(key)), loadMore };
}
