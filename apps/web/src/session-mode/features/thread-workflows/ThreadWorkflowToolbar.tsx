import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  findThreadMatches,
  exportThreadMarkdown,
  makeThreadUrl,
  type WorkflowMessage,
  type WorkflowAnchor,
  type WorkflowTurn,
  type ThreadSearchMatch,
} from "./model";
import { nativeSearchMatches } from "./nativeSearch";
import { useNativeThreadSearch } from "./useNativeThreadSearch";
import { downloadThreadMarkdown } from "./service";
import { threadWorkflowActions, useThreadWorkflowActions } from "./actions";
import { useAgentInteractionVisible } from "@session/session-dom";
import { ThreadEditRecovery } from "./ThreadEditRecovery";
import "./thread-workflows.css";

export interface ThreadWorkflowToolbarProps {
  threadId: string;
  rows: readonly WorkflowMessage[];
  turns: readonly WorkflowTurn[];
  onNavigate: (anchor: WorkflowAnchor) => void;
  onPrepareMatch?: (match: ThreadSearchMatch) => Promise<WorkflowAnchor | null>;
  title?: string;
  running?: boolean;
  inspection?: boolean;
  historyComplete?: boolean;
  onLoadEarlier?: () => void | Promise<void>;
}
export function ThreadWorkflowToolbar({
  threadId,
  rows,
  onNavigate,
  onPrepareMatch,
  title,
  historyComplete = true,
  onLoadEarlier,
}: ThreadWorkflowToolbarProps) {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const label = (cn: string, en: string) => (zh ? cn : en);
  const rootRef = useRef<HTMLDivElement>(null);
  const interactionVisible = useAgentInteractionVisible();
  const panel = useThreadWorkflowActions((state) => state.panels[threadId]);
  const request = useThreadWorkflowActions((state) => state.requests[threadId]);
  const focusRequest = useThreadWorkflowActions(
    (state) => state.focusRequests[threadId],
  );
  const moveRequest = useThreadWorkflowActions(
    (state) => state.moveRequests[threadId],
  );
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(-1);
  const searchOpen = panel === "search",
    usersOpen = panel === "users";
  const visible = () => {
    if (!rootRef.current || !interactionVisible) return false;
    for (
      let element: HTMLElement | null = rootRef.current;
      element;
      element = element.parentElement
    )
      if (
        element.hidden ||
        element.hasAttribute("inert") ||
        getComputedStyle(element).display === "none"
      )
        return false;
    return true;
  };
  const nativeSearch = useNativeThreadSearch(
    threadId,
    query,
    searchOpen && interactionVisible,
    visible,
  );
  const navigation = useRef({
    threadId,
    query,
    searchOpen,
    onNavigate,
    onPrepareMatch,
  });
  navigation.current = {
    threadId,
    query,
    searchOpen,
    onNavigate,
    onPrepareMatch,
  };
  const navigationRevision = useRef(0);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  useEffect(() => {
    if (!request || !interactionVisible) return;
    for (
      let element: HTMLElement | null = rootRef.current;
      element;
      element = element.parentElement
    ) {
      if (
        element.hidden ||
        element.hasAttribute("inert") ||
        window.getComputedStyle(element).display === "none"
      )
        return;
    }
    if (!threadWorkflowActions.consume(request)) return;
    if (request.action === "export") {
      if (!historyComplete)
        toast.info(
          label(
            "本次导出仅包含已载入历史。",
            "Export includes loaded history only.",
          ),
        );
      downloadThreadMarkdown(
        exportThreadMarkdown(rows, title, i18n?.language ?? "en"),
        title || threadId,
      );
    } else
      void navigator.clipboard
        .writeText(makeThreadUrl(window.location.href, request.threadId))
        .then(
          () =>
            toast.success(label("会话链接已复制", "Conversation link copied")),
          () =>
            toast.error(
              label("未能复制会话链接", "Could not copy conversation link"),
            ),
        );
  }, [request, rows, title, threadId, historyComplete, interactionVisible]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (
      !searchOpen ||
      !focusRequest ||
      !interactionVisible ||
      !root ||
      (focusRequest.ownerRoot && !focusRequest.ownerRoot.contains(root))
    )
      return;
    for (
      let element: HTMLElement | null = root;
      element;
      element = element.parentElement
    )
      if (
        element.hidden ||
        element.hasAttribute("inert") ||
        getComputedStyle(element).display === "none"
      )
        return;
    if (threadWorkflowActions.consumeFocus(threadId, focusRequest.id))
      input.current?.focus({ preventScroll: true });
  }, [searchOpen, focusRequest, interactionVisible, threadId]);
  const localMatches = useMemo(
    () => findThreadMatches(rows, query),
    [rows, query],
  );
  const matches = useMemo(
    () =>
      nativeSearch.error
        ? []
        : nativeSearch.data === null
          ? localMatches
          : nativeSearchMatches(threadId, query.trim(), nativeSearch.data),
    [nativeSearch.error, nativeSearch.data, localMatches, threadId, query],
  );
  const selected =
    matches.length && index >= 0 ? Math.min(index, matches.length - 1) : -1;
  useEffect(() => setIndex(-1), [threadId, query, nativeSearch.data === null]);
  const users = useMemo(
    () => rows.filter((row) => row.role === "user"),
    [rows],
  );
  const navigateMatch = (match: ThreadSearchMatch) => {
    const revision = ++navigationRevision.current;
    const captured = navigation.current;
    setNavigationError(null);
    if (match.rowId) {
      captured.onNavigate({ ...match, rowId: match.rowId });
      return;
    }
    if (!captured.onPrepareMatch) {
      setNavigationError(
        label(
          "尚不能定位这条原生历史消息",
          "This native history message cannot be located yet",
        ),
      );
      return;
    }
    void captured.onPrepareMatch(match).then(
      (anchor) => {
        const latest = navigation.current;
        if (
          revision !== navigationRevision.current ||
          latest.threadId !== captured.threadId ||
          latest.query !== captured.query ||
          !latest.searchOpen ||
          !visible()
        )
          return;
        if (
          !anchor ||
          anchor.turnId !== match.turnId ||
          anchor.itemId !== match.itemId
        ) {
          setNavigationError(
            label(
              "原生历史中未找到这条消息",
              "The message was not found in native history",
            ),
          );
          return;
        }
        latest.onNavigate({
          ...anchor,
          query: match.query,
          occurrence: match.occurrence,
        });
      },
      (error) => {
        const latest = navigation.current;
        if (
          revision === navigationRevision.current &&
          latest.threadId === captured.threadId &&
          latest.query === captured.query &&
          latest.searchOpen
        )
          setNavigationError(
            error instanceof Error ? error.message : String(error),
          );
      },
    );
  };
  const move = (step: number) => {
    if (!matches.length) return;
    const next =
      ((selected < 0 ? (step > 0 ? -1 : 0) : selected) +
        step +
        matches.length) %
      matches.length;
    setIndex(next);
    navigateMatch(matches[next]);
  };
  useEffect(() => {
    const root = rootRef.current;
    if (
      !searchOpen ||
      !moveRequest ||
      !interactionVisible ||
      !root ||
      (moveRequest.ownerRoot && !moveRequest.ownerRoot.contains(root))
    )
      return;
    for (
      let element: HTMLElement | null = root;
      element;
      element = element.parentElement
    )
      if (
        element.hidden ||
        element.hasAttribute("inert") ||
        getComputedStyle(element).display === "none"
      )
        return;
    if (threadWorkflowActions.consumeMove(threadId, moveRequest.id))
      move(moveRequest.step);
  }, [
    moveRequest,
    searchOpen,
    interactionVisible,
    selected,
    matches,
    threadId,
  ]);
  return (
    <div
      ref={rootRef}
      className="codex-thread-workflows"
      data-thread-workflows={threadId}
    >
      <ThreadEditRecovery threadId={threadId} rows={rows} />
      {searchOpen && (
        <section
          className="codex-thread-search"
          aria-label={label("会话内搜索", "Search within conversation")}
        >
          <div className="codex-thread-search-input">
            <Search aria-hidden size={15} />
            <input
              ref={input}
              aria-label={label("搜索会话正文", "Search conversation text")}
              value={query}
              placeholder={label("搜索会话正文…", "Find in conversation…")}
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(-1);
                ++navigationRevision.current;
                setNavigationError(null);
              }}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (query.trim() && matches.length) {
                    move(event.shiftKey ? -1 : 1);
                  }
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  threadWorkflowActions.close(threadId);
                }
              }}
            />
            <span role="status">
              {selected < 0 ? 0 : selected + 1}/{matches.length}
              {nativeSearch.nextCursor ? "+" : ""}
              {nativeSearch.loading ? "…" : ""}
            </span>
            <button
              type="button"
              aria-label={label("上一个搜索结果", "Previous match")}
              disabled={!matches.length}
              onClick={() => move(-1)}
            >
              <ChevronUp aria-hidden size={16} />
            </button>
            <button
              type="button"
              aria-label={label("下一个搜索结果", "Next match")}
              disabled={!matches.length}
              onClick={() => move(1)}
            >
              <ChevronDown aria-hidden size={16} />
            </button>
            <button
              type="button"
              aria-label={label("关闭搜索", "Close search")}
              onClick={() => threadWorkflowActions.close(threadId)}
            >
              <X aria-hidden size={15} />
            </button>
          </div>
          {nativeSearch.error && <p role="alert">{nativeSearch.error}</p>}
          {navigationError && <p role="alert">{navigationError}</p>}
          {nativeSearch.data === null &&
            !nativeSearch.error &&
            !historyComplete && (
              <div className="codex-thread-history-scope">
                {label(
                  "搜索与导出仅包含已载入历史。",
                  "Search and export include loaded history only.",
                )}{" "}
                {onLoadEarlier && (
                  <button type="button" onClick={() => void onLoadEarlier()}>
                    {label("载入更早历史", "Load earlier history")}
                  </button>
                )}
              </div>
            )}
          {!!query.trim() && (
            <div className="codex-thread-search-results" role="list">
              {matches.slice(0, 100).map((match, number) => (
                <button
                  key={`${match.turnId}:${match.itemId}:${match.occurrence}`}
                  type="button"
                  role="listitem"
                  className={number === selected ? "selected" : ""}
                  onClick={() => {
                    setIndex(number);
                    navigateMatch(match);
                  }}
                >
                  <span className="codex-thread-match-speaker">
                    {match.role === "user"
                      ? label("你", "You")
                      : match.role === "plan"
                        ? label("计划", "Plan")
                        : match.role === "summary"
                          ? label("公开摘要", "Summary")
                          : match.role === "assistant"
                            ? "Codex"
                            : label("消息", "Message")}
                  </span>
                  {match.snippetMatchRange ? (
                    <span>
                      {match.preview.slice(0, match.snippetMatchRange.start)}
                      <mark>
                        {match.preview.slice(
                          match.snippetMatchRange.start,
                          match.snippetMatchRange.end,
                        )}
                      </mark>
                      {match.preview.slice(match.snippetMatchRange.end)}
                    </span>
                  ) : (
                    match.preview
                  )}
                </button>
              ))}
              {!matches.length &&
                !nativeSearch.loading &&
                !nativeSearch.error && (
                  <p>{label("没有匹配结果", "No matches")}</p>
                )}
              {matches.length > 100 && (
                <p>
                  {label(
                    "显示前 100 条；使用上/下一个浏览全部结果。",
                    "Showing first 100; use previous/next to navigate all matches.",
                  )}
                </p>
              )}
              {nativeSearch.nextCursor && (
                <button
                  type="button"
                  disabled={nativeSearch.loading}
                  onClick={nativeSearch.loadMore}
                >
                  {label("载入更多搜索结果", "Load more matches")}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {usersOpen && (
        <nav
          className="codex-thread-user-navigation"
          aria-label={label("用户消息导航", "User message navigation")}
        >
          <button
            type="button"
            aria-label={label(
              "关闭用户消息导航",
              "Close user message navigation",
            )}
            onClick={() => threadWorkflowActions.close(threadId)}
          >
            <X size={15} aria-hidden />
            {label("关闭", "Close")}
          </button>
          {users.map((row, number) => (
            <button
              type="button"
              key={row.rowId}
              title={row.text}
              data-thread-user-message-navigation-item-id={row.itemId}
              onClick={() => onNavigate(row)}
            >
              <span aria-hidden>{number + 1}</span>
              {row.text || label("附件消息", "Attachment message")}
            </button>
          ))}
          {!users.length && <p>{label("尚无用户消息", "No user messages")}</p>}
        </nav>
      )}
    </div>
  );
}

/** The floating native rail shares the exact stable anchors used by search, including virtualized rows. */
export function ThreadUserNavigationRail({
  rows,
  onNavigate,
  activeTurnId,
}: {
  rows: readonly WorkflowMessage[];
  onNavigate: (anchor: WorkflowAnchor) => void;
  activeTurnId?: string;
}) {
  const users = rows.filter((row) => row.role === "user");
  const scrubbing = useRef<{ pointerId: number; itemId: string } | null>(null);
  const skipClick = useRef(false);
  if (users.length < 2) return null;
  return (
    <nav
      className="codex-thread-user-rail"
      aria-label="用户消息导航"
      data-thread-user-message-navigation-rail-list
      data-floating-navigation-rail-list
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-thread-user-message-navigation-item-id]",
        );
        const itemId = button?.dataset.threadUserMessageNavigationItemId;
        if (!itemId) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        scrubbing.current = { pointerId: event.pointerId, itemId };
        skipClick.current = false;
      }}
      onPointerMove={(event) => {
        const drag = scrubbing.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const button = document
          .elementFromPoint?.(event.clientX, event.clientY)
          ?.closest<HTMLElement>(
            "[data-thread-user-message-navigation-item-id]",
          );
        const row = users.find(
          (item) =>
            item.itemId === button?.dataset.threadUserMessageNavigationItemId,
        );
        if (row && row.itemId !== drag.itemId) {
          drag.itemId = row.itemId;
          skipClick.current = true;
          onNavigate(row);
        }
      }}
      onPointerUp={(event) => {
        if (scrubbing.current?.pointerId === event.pointerId)
          scrubbing.current = null;
      }}
      onPointerCancel={() => (scrubbing.current = null)}
    >
      {users.map((row, index) => (
        <button
          type="button"
          key={row.rowId}
          aria-label={`用户消息 ${index + 1}：${row.text.slice(0, 100) || "附件"}`}
          title={row.text.slice(0, 250)}
          aria-current={activeTurnId === row.turnId ? "true" : undefined}
          data-thread-user-message-navigation-item-id={row.itemId}
          onClick={() => {
            if (skipClick.current) {
              skipClick.current = false;
              return;
            }
            onNavigate(row);
          }}
        >
          <span className="codex-user-rail-marker">
            <span className="codex-user-rail-marker-line" />
          </span>
        </button>
      ))}
    </nav>
  );
}
