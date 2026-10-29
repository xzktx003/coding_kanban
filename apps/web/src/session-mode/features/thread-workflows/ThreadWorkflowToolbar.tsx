import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
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
import {
  useAgentInteractionVisible,
  sessionPortalContainer,
} from "@session/session-dom";
import { railPreviewPosition } from "./railPreviewPosition";
import { ThreadEditRecovery } from "./ThreadEditRecovery";
import { writeNativeMarkdownClipboard } from "@session/components/codex/presentation/nativeMarkdownClipboard";
import "./thread-workflows.css";

/**
 * Taken from the shipped 26.51007.21434 prompt rail
 * (`thread-user-message-navigation-rail-5c89c24e73d1.js`): it returns null
 * below four rows and publishes a neighbour distance only within three rows of
 * the one under the pointer.
 */
const NAVIGATION_RAIL_MINIMUM_ROWS = 4;
const NAVIGATION_RAIL_FALLOFF_ROWS = 3;
/**
 * The rail's hover card opens on a delay, and the shipped bundle has two
 * different delays here that are easy to read as one.
 *
 * `jt=150` (declared beside `Mt=`[data-turn-key]``) schedules `xe`, which is
 * the preview *prefetch*, guarded by a cache that evicts on failure:
 *
 *   oe.current.has(e.id) || (oe.current.add(e.id),
 *     u(e).then(t => { t === !1 && oe.current.delete(e.id) })…)
 *   … setTimeout(() => { E.current = null; xe(e) }, jt)
 *
 * That fetches data; it does not open anything. The card itself is a shared
 * tooltip rendered with `delayOpen:!0` and
 * `skipDelayKey:`thread-user-message-navigation`` and no `delayDuration`, so
 * its open delay falls through to the tooltip default `delayDuration ?? n ?? 200`
 * (context `t4t` defaults to `null`). `chatgpt-conversation-turn-content`
 * passes `delayDuration:200` explicitly, confirming the figure independently.
 *
 * Our transcript rows are already in memory and `previewFor` reads them
 * synchronously, so there is no prefetch for 150 to govern — the open delay is
 * the only one we have, and it is 200. Sweeping the rail still does not flash a
 * card per marker, and a row previewed once reopens with no wait.
 */
const NAVIGATION_RAIL_PREVIEW_DEBOUNCE_MS = 200;
/** The plugin shows two output chips before collapsing the rest into `+{count}` (`dt=2`). */
const NAVIGATION_RAIL_PREVIEW_OUTPUTS = 2;

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
    const markdown = exportThreadMarkdown(rows, title, i18n?.language ?? "en");
    if (request.action === "export" || request.action === "copyMarkdown") {
      if (!historyComplete)
        toast.info(
          label(
            "本次导出仅包含已载入历史。",
            "Export includes loaded history only.",
          ),
        );
      if (request.action === "export")
        downloadThreadMarkdown(markdown, title || threadId);
      else
        void writeNativeMarkdownClipboard(markdown).then(
          () =>
            toast.success(
              label("已复制为 Markdown", "Copied conversation as Markdown"),
            ),
          () =>
            toast.error(
              label("未能复制为 Markdown", "Could not copy conversation"),
            ),
        );
    } else
      void writeNativeMarkdownClipboard(
        makeThreadUrl(window.location.href, request.threadId),
      ).then(
        () =>
          toast.success(
            label(
              request.action === "copyDeeplink"
                ? "已复制深层链接"
                : "会话链接已复制",
              "Conversation link copied",
            ),
          ),
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

/**
 * The rail's hover card, ported from the shipped
 * `thread-user-message-navigation-rail-5c89c24e73d1.js`. Its layout is three
 * stacked parts under one `overflow-hidden` box:
 *
 *   <div className="flex min-w-0 items-center gap-1.5 font-medium">    // label
 *     <span className="min-w-0 flex-1 truncate">{label}</span>
 *   <Markdown className="mt-1 line-clamp-3 …">{response}</Markdown>   // reply
 *   <div className="mt-2 flex min-w-0 items-center gap-3 …">          // outputs
 *
 * An empty prompt falls back to `noContent` and a prompt whose turn could not
 * be read falls back to `previewUnavailable`, so the card is never blank.
 *
 * Our transcript rows arrive already hydrated, so `loading` only occurs for a
 * turn still streaming its first reply; `unavailable` covers a row whose turn
 * body was dropped by memory reclamation and has no text to show.
 */
function ThreadUserRailPreview({
  label,
  response,
  state,
  style,
}: {
  label: string;
  response: string;
  state: "ready" | "loading" | "unavailable";
  style?: CSSProperties;
}) {
  const { t } = useTranslation("thread");
  if (state === "loading")
    return (
      <div
        className="codex-user-rail-preview overflow-hidden"
        data-thread-user-message-navigation-tooltip-preview
        style={style}
      >
        {/* The plugin's skeleton: an announced status plus three decaying bars. */}
        <div className="motion-safe:animate-pulse" role="status">
          <span className="sr-only">
            {t("userMessageNavigation.loadingPreview")}
          </span>
          <div aria-hidden className="flex h-5 min-w-0 items-center gap-1.5">
            <div className="h-3 w-3/5 rounded bg-foreground/10" />
          </div>
          <div aria-hidden className="mt-1 flex flex-col">
            <div className="flex h-5 items-center">
              <div className="h-3 w-full rounded bg-foreground/10" />
            </div>
            <div className="flex h-5 items-center">
              <div className="h-3 w-11/12 rounded bg-foreground/10" />
            </div>
            <div className="flex h-5 items-center">
              <div className="h-3 w-4/5 rounded bg-foreground/10" />
            </div>
          </div>
        </div>
      </div>
    );
  const text =
    state === "unavailable"
      ? t("userMessageNavigation.previewUnavailable")
      : label.trim().length > 0
        ? label
        : t("userMessageNavigation.noContent");
  return (
    <div
      className="codex-user-rail-preview overflow-hidden"
      data-thread-user-message-navigation-tooltip-preview
      style={style}
    >
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        <span className="min-w-0 flex-1 truncate" data-rail-preview-label>
          {text}
        </span>
      </div>
      {state === "ready" && response.trim().length > 0 && (
        <div
          className="codex-user-rail-preview-response mt-1 line-clamp-3"
          data-rail-preview-response
        >
          {response}
        </div>
      )}
    </div>
  );
}

/** The floating native rail shares the exact stable anchors used by search, including virtualized rows. */
/**
 * Codex portals the hover card (`portalContainer: s`) and drives it off a
 * `positioningElement` rather than nesting it in the marker it belongs to. We
 * have to do the same: `.codex-thread-user-rail` is `overflow-y: auto` beneath
 * a fade `mask`, so a nested card is clipped horizontally by the scroll box and
 * faded out vertically by the mask. The portal escapes both while staying under
 * `.session-mode`, which is where our scoped styling and Portal-bound shortcut
 * handling live.
 *
 * The anchor is looked up by item id instead of being passed as a ref so the
 * marker stays a plain element in the map above, and is re-measured on scroll
 * and resize because the rail scrolls independently of the transcript.
 */
function ThreadUserRailPreviewPortal({
  anchorItemId,
  ...props
}: {
  anchorItemId: string;
  label: string;
  response: string;
  state: "ready" | "loading" | "unavailable";
}) {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const findAnchor = () =>
      document.querySelector<HTMLElement>(
        `[data-thread-user-message-navigation-item-id="${CSS.escape(anchorItemId)}"]`,
      );
    const initialAnchor = findAnchor();
    if (!initialAnchor) return;
    let frame = 0;
    const update = () => {
      // A long rail can recycle this marker while its preview is open. Never
      // position a card against a detached node retained by an old closure.
      const anchor = findAnchor();
      if (!anchor) {
        setStyle(undefined);
        return;
      }
      const viewport = window.visualViewport;
      setStyle(
        railPreviewPosition(anchor.getBoundingClientRect(), {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? window.innerWidth,
          height: viewport?.height ?? window.innerHeight,
        }),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(initialAnchor);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchorItemId]);
  const container = sessionPortalContainer();
  if (!container || !style) return null;
  return createPortal(
    <ThreadUserRailPreview {...props} style={style} />,
    container,
  );
}

function sameTurnIds(
  previous?: ReadonlySet<string>,
  next?: ReadonlySet<string>,
) {
  if ((previous?.size ?? 0) !== (next?.size ?? 0)) return false;
  for (const id of previous ?? []) if (!next?.has(id)) return false;
  return true;
}

const RAIL_WINDOW_THRESHOLD = 128;
const RAIL_MARKER_HEIGHT = 10;
const RAIL_MAX_VIEWPORT_HEIGHT = 640;
const RAIL_OVERSCAN = 8;

type RailMarkerProps = {
  indices?: readonly number[];
  windowed: boolean;
  users: readonly WorkflowMessage[];
  focusIndex: number;
  scrubTarget: string | null;
  activeTurnIds?: ReadonlySet<string>;
  onHighlight: (id: string) => void;
  onClose: () => void;
  onNavigate: (row: WorkflowMessage, keyboard: boolean) => void;
};
function ThreadUserRailMarkersImpl({
  indices,
  windowed,
  users,
  focusIndex,
  scrubTarget,
  activeTurnIds,
  onHighlight,
  onClose,
  onNavigate,
}: RailMarkerProps) {
  const { t } = useTranslation("thread");
  return (
    <>
      {(indices ?? users.map((_, index) => index)).map((index) => {
        const row = users[index]!;
        const distance = Math.abs(index - focusIndex);
        return (
          <button
            type="button"
            key={row.rowId}
            style={
              windowed
                ? { position: "absolute", top: index * RAIL_MARKER_HEIGHT }
                : undefined
            }
            data-thread-user-message-navigation-index={index}
            aria-posinset={windowed ? index + 1 : undefined}
            aria-setsize={windowed ? users.length : undefined}
            // The plugin labels markers by position alone and puts the
            // message text in the hover card; a native `title` would race the
            // card and show a second, unstyled copy of the same text.
            aria-label={t("userMessageNavigation.jumpAriaLabel", {
              position: index + 1,
            })}
            aria-current={activeTurnIds?.has(row.turnId) ? "true" : undefined}
            data-thread-user-message-navigation-item-id={row.itemId}
            data-scrub-target={row.itemId === scrubTarget ? "true" : undefined}
            onPointerEnter={() => {
              onHighlight(row.itemId);
            }}
            onPointerLeave={onClose}
            onFocus={() => {
              onHighlight(row.itemId);
            }}
            onBlur={onClose}
            onClick={(event) => onNavigate(row, event.detail === 0)}
          >
            {/* The shipped rail wraps a 26px marker in a 30px row box. */}
            <span className="codex-user-rail-marker-slot">
              <span
                className="codex-user-rail-marker"
                data-neighbor-distance={
                  focusIndex >= 0 && distance <= NAVIGATION_RAIL_FALLOFF_ROWS
                    ? distance
                    : undefined
                }
              >
                <span className="codex-user-rail-marker-line" />
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}
const ThreadUserRailMarkers = memo(
  ThreadUserRailMarkersImpl,
  (before, after) =>
    before.indices === after.indices &&
    before.windowed === after.windowed &&
    before.users === after.users &&
    before.focusIndex === after.focusIndex &&
    before.scrubTarget === after.scrubTarget &&
    sameTurnIds(before.activeTurnIds, after.activeTurnIds) &&
    before.onHighlight === after.onHighlight &&
    before.onClose === after.onClose &&
    before.onNavigate === after.onNavigate,
);

function ThreadUserNavigationRailImpl({
  rows,
  onNavigate,
  activeTurnIds,
}: {
  rows: readonly WorkflowMessage[];
  onNavigate: (anchor: WorkflowAnchor) => void;
  /**
   * The turns currently intersecting the transcript viewport. The shipped rail
   * holds a Set and marks every member (`"aria-current": g.has(t.id)`), so a
   * viewport spanning two short prompts lights both: that range is the signal
   * telling the reader where they are, which one navigated turn cannot carry.
   */
  activeTurnIds?: ReadonlySet<string>;
}) {
  const { t } = useTranslation("thread");
  const previousUsers = useRef<readonly WorkflowMessage[]>([]);
  const users = useMemo(() => {
    const next = rows.filter((row) => row.role === "user");
    const previous = previousUsers.current;
    if (
      next.length === previous.length &&
      next.every((row, index) => {
        const old = previous[index]!;
        return (
          row.rowId === old.rowId &&
          row.itemId === old.itemId &&
          row.turnId === old.turnId &&
          row.text === old.text &&
          row.completed === old.completed &&
          row.phase === old.phase
        );
      })
    )
      return previous;
    previousUsers.current = next;
    return next;
  }, [rows]);
  const railElement = useRef<HTMLElement | null>(null);
  const windowed = users.length > RAIL_WINDOW_THRESHOLD;
  const [windowRange, setWindowRange] = useState({ start: 0, end: 80 });
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  // Retention/prepend can move an existing focused prompt to a new index.
  // Derive it during render, so its DOM node remains pinned in this commit.
  const focusedMarker =
    focusedRowId === null
      ? null
      : users.findIndex((row) => row.rowId === focusedRowId);
  const updateWindow = useCallback(() => {
    const element = railElement.current;
    if (!element || !windowed) return;
    const height = Math.min(
      element.clientHeight || RAIL_MAX_VIEWPORT_HEIGHT,
      RAIL_MAX_VIEWPORT_HEIGHT,
    );
    const start = Math.max(
      0,
      Math.floor(element.scrollTop / RAIL_MARKER_HEIGHT) - RAIL_OVERSCAN,
    );
    const end =
      Math.ceil((element.scrollTop + height) / RAIL_MARKER_HEIGHT) +
      RAIL_OVERSCAN;
    setWindowRange((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  }, [windowed]);
  useLayoutEffect(() => {
    if (!windowed || !railElement.current) return;
    updateWindow();
    const observer = new ResizeObserver(updateWindow);
    observer.observe(railElement.current);
    return () => observer.disconnect();
  }, [windowed, updateWindow]);
  const markerIndices = useMemo(() => {
    if (!windowed) return undefined;
    const indices = new Set([0, users.length - 1]);
    for (
      let index = windowRange.start;
      index < Math.min(users.length, windowRange.end);
      index++
    )
      indices.add(index);
    if (
      focusedMarker !== null &&
      focusedMarker >= 0 &&
      focusedMarker < users.length
    )
      indices.add(focusedMarker);
    return [...indices].sort((a, b) => a - b);
  }, [windowed, users.length, windowRange, focusedMarker]);
  const focusMarker = (index: number) => {
    const element = railElement.current;
    if (!element) return;
    const height = element.clientHeight || RAIL_MAX_VIEWPORT_HEIGHT;
    const top = index * RAIL_MARKER_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + RAIL_MARKER_HEIGHT > element.scrollTop + height)
      element.scrollTop = top + RAIL_MARKER_HEIGHT - height;
    flushSync(() => {
      setFocusedRowId(users[index]!.rowId);
      updateWindow();
    });
    element
      .querySelector<HTMLElement>(
        `[data-thread-user-message-navigation-index="${index}"]`,
      )
      ?.focus({ preventScroll: true });
  };
  const onNavigateRef = useRef(onNavigate);
  useLayoutEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  const scrubbing = useRef<{ pointerId: number; itemId: string } | null>(null);
  const skipClick = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [scrubTarget, setScrubTarget] = useState<string | null>(null);
  // The row whose hover card is open. It trails `hovered` by the plugin's
  // debounce, so sweeping the rail does not flash a card per marker.
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const previewTimer = useRef<{ itemId: string; handle: number } | null>(null);
  // The plugin's own preview cache: a row previewed once reopens with no wait.
  const previewed = useRef(new Set<string>());
  useEffect(
    () => () => {
      if (previewTimer.current)
        window.clearTimeout(previewTimer.current.handle);
    },
    [],
  );
  const openPreview = useCallback((itemId: string) => {
    if (previewTimer.current?.itemId === itemId) return;
    if (previewTimer.current) {
      window.clearTimeout(previewTimer.current.handle);
      previewTimer.current = null;
    }
    if (previewed.current.has(itemId)) {
      setPreviewItemId(itemId);
      return;
    }
    const handle = window.setTimeout(() => {
      previewTimer.current = null;
      previewed.current.add(itemId);
      setPreviewItemId(itemId);
    }, NAVIGATION_RAIL_PREVIEW_DEBOUNCE_MS);
    previewTimer.current = { itemId, handle };
  }, []);
  const closePreview = useCallback(() => {
    if (previewTimer.current) {
      window.clearTimeout(previewTimer.current.handle);
      previewTimer.current = null;
    }
    setPreviewItemId(null);
  }, []);
  const highlightMarker = useCallback(
    (itemId: string) => {
      setHovered(itemId);
      openPreview(itemId);
    },
    [openPreview],
  );
  const navigateFromMarker = useCallback(
    (row: WorkflowMessage, keyboard: boolean) => {
      if (skipClick.current && !keyboard) {
        skipClick.current = false;
        return;
      }
      skipClick.current = false;
      onNavigateRef.current(row);
    },
    [],
  );
  /**
   * The reply the rail previews beside a prompt: the first assistant row of the
   * same turn. Rows arrive in transcript order, so a turn still streaming has a
   * prompt with no assistant row yet (`loading`), while a turn whose body was
   * reclaimed has one with empty text (`unavailable`).
   */
  const previewFor = (row: WorkflowMessage) => {
    const reply = rows.find(
      (item) => item.turnId === row.turnId && item.role === "assistant",
    );
    // No reply row yet: the turn is still producing its first message.
    if (!reply) return { response: "", state: "loading" as const };
    // Settled with nothing to show: the body is gone rather than pending.
    if (reply.completed === true && reply.text.trim().length === 0)
      return { response: "", state: "unavailable" as const };
    if (reply.text.trim().length === 0)
      return { response: "", state: "loading" as const };
    return { response: reply.text, state: "ready" as const };
  };
  // The shipped rail measures proximity from the row under the pointer
  // (scrubbed first, else hovered), never from the active turn.
  const previewRow = previewItemId
    ? users.find((row) => row.itemId === previewItemId)
    : undefined;
  const focused = scrubTarget ?? hovered;
  const focusIndex = users.findIndex((row) => row.itemId === focused);
  // Below four prompts the rail is noise next to the transcript, so the
  // shipped component renders nothing at all.
  if (users.length < NAVIGATION_RAIL_MINIMUM_ROWS) return null;
  return (
    <nav
      ref={railElement}
      onScroll={windowed ? updateWindow : undefined}
      onFocusCapture={
        windowed
          ? (event) => {
              const index = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-thread-user-message-navigation-index]",
              )?.dataset.threadUserMessageNavigationIndex;
              if (index !== undefined)
                setFocusedRowId(users[Number(index)]?.rowId ?? null);
            }
          : undefined
      }
      onBlurCapture={
        windowed
          ? (event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setFocusedRowId(null);
            }
          : undefined
      }
      onKeyDown={
        windowed
          ? (event) => {
              if (event.key !== "Tab") return;
              const value = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-thread-user-message-navigation-index]",
              )?.dataset.threadUserMessageNavigationIndex;
              if (value === undefined) return;
              const next = Number(value) + (event.shiftKey ? -1 : 1);
              if (next < 0 || next >= users.length) return;
              event.preventDefault();
              focusMarker(next);
            }
          : undefined
      }
      className="codex-thread-user-rail"
      aria-label={t("userMessageNavigation.ariaLabel")}
      data-thread-user-message-navigation-rail-list
      data-floating-navigation-rail-list
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-thread-user-message-navigation-item-id]",
        );
        const itemId = button?.dataset.threadUserMessageNavigationItemId;
        if (!itemId) return;
        // A tap must retain its button as the native click target. Capture only
        // after crossing to another marker, when this becomes a scrub gesture.
        scrubbing.current = { pointerId: event.pointerId, itemId };
        setScrubTarget(itemId);
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
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.itemId = row.itemId;
          setScrubTarget(row.itemId);
          skipClick.current = true;
          onNavigate(row);
        }
      }}
      onPointerUp={(event) => {
        if (scrubbing.current?.pointerId !== event.pointerId) return;
        // Capture retargets every move to this `<nav>`, so the row the drag
        // ended on never received `pointerEnter` and `hovered` is still the row
        // the press began from. Hand the drag's last row over before clearing
        // the scrub, or the taper snaps back to the press origin while the
        // browser puts `:hover` on the row actually under the pointer.
        setHovered(scrubbing.current.itemId);
        scrubbing.current = null;
        setScrubTarget(null);
      }}
      onPointerCancel={() => {
        // A cancelled drag (the browser taking over for a scroll or gesture)
        // leaves the pointer nowhere meaningful, so drop the focus entirely
        // rather than stranding it on the last row touched.
        scrubbing.current = null;
        setScrubTarget(null);
        setHovered(null);
      }}
      onPointerLeave={(event) => {
        const drag = scrubbing.current;
        if (drag && !event.currentTarget.hasPointerCapture?.(drag.pointerId)) {
          scrubbing.current = null;
          setScrubTarget(null);
        }
        setHovered(null);
        closePreview();
      }}
      data-scrubbing={scrubTarget != null ? "true" : undefined}
    >
      <div
        style={
          windowed
            ? {
                position: "relative",
                height: users.length * RAIL_MARKER_HEIGHT,
                width: 36,
                flex: "none",
              }
            : { display: "contents" }
        }
      >
        <ThreadUserRailMarkers
          indices={markerIndices}
          windowed={windowed}
          users={users}
          focusIndex={focusIndex}
          scrubTarget={scrubTarget}
          activeTurnIds={activeTurnIds}
          onHighlight={highlightMarker}
          onClose={closePreview}
          onNavigate={navigateFromMarker}
        />{" "}
      </div>

      {previewRow && (
        <ThreadUserRailPreviewPortal
          anchorItemId={previewRow.itemId}
          label={previewRow.text}
          {...previewFor(previewRow)}
        />
      )}
    </nav>
  );
}

export const ThreadUserNavigationRail = memo(
  ThreadUserNavigationRailImpl,
  (before, after) => {
    if (before.rows !== after.rows || before.onNavigate !== after.onNavigate)
      return false;
    // The virtualized parent computes a fresh Set on each streamed render. Its
    // members, rather than object identity, determine the rail's current markers.
    return sameTurnIds(before.activeTurnIds, after.activeTurnIds);
  },
);
