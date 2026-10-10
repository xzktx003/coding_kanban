import { pruneRowState } from "./pruneRowState";
import { useTranscriptVisibility } from "../hooks/useTranscriptVisibility";
import {
  isCodexTranscriptDormant,
  needsCodexTranscriptRestore,
  onCodexTranscriptReleased,
} from "@session/services/codexTranscriptActivity";
import { TranscriptInspectionContext } from "./inspection";
import { CodexAccessNotice } from "./CodexAccessNotice";
import { useSessionReadReceipt } from "@session/hooks/useSessionReadReceipt";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { codexService } from "@session/services/codexService";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "@session/components/codex/stores";
import { ScrollArea } from "@session/components/ui/scroll-area";
import { EventItem } from "../items";
import { AgentMessageItem } from "../items/AgentMessageItem";
import { ApprovalItem } from "../items/ApprovalItem";
import { CommandActionSummaryItem } from "../items/CommandActionSummaryItem";
import { ElicitationItem } from "../items/ElicitationItem";
import { PermissionsItem } from "../items/PermissionsItem";
import { RequestUserInputItem } from "../items/RequestUserInputItem";
import { ScrollToBottomButton } from "../widget/ScrollToBottomButton";
import { WorkingIndicator } from "../widget/WorkingIndicator";
import { RowStateContext } from "./rowState";
import { buildThreadRows, type ThreadRow } from "./threadRows";
import { CodexDeliveryEchoes } from "./CodexDeliveryEchoes";
import {
  getReadingPosition,
  saveReadingPosition,
  type ReadingPosition,
} from "@session/services/sessionTranscriptCache";
import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";

interface CodexThreadProps {
  threadId?: string;
  inspection?: boolean;
  /** Fixed-height cards resolve their height through flex rather than h-full. */
  fillHeight?: boolean;
}
const EMPTY_EVENTS: ServerNotification[] = [];
const positions = new Map<
  string,
  {
    measurements: VirtualItem[];
    width: number;
    disclosure: Map<string, Map<string, unknown>>;
  }
>();
// The cache owns only disposable view state. Unmount may follow the release
// notification, so its cleanup must also avoid writing a dormant entry back.
const stopPositionCleanup = onCodexTranscriptReleased((id) =>
  positions.delete(id),
);
if (import.meta.hot) import.meta.hot.dispose(stopPositionCleanup);
const ThreadMessage = memo(
  function ThreadMessage({ row }: { row: ThreadRow }) {
    const item = row.item;
    return item.kind === "cmdGroup" ? (
      <CommandActionSummaryItem
        actions={item.actions}
        actionSources={item.actionSources}
        completed={item.completed}
      />
    ) : (
      <EventItem event={item.event} context={row.context} />
    );
  },
  (before, after) => {
    if (before.row === after.row) return true;
    return (
      before.row.item.kind === "event" &&
      after.row.item.kind === "event" &&
      before.row.item.event === after.row.item.event &&
      before.row.context?.rollbackTurns === after.row.context?.rollbackTurns &&
      before.row.context?.events === after.row.context?.events
    );
  },
);

const CodexTranscript = memo(function CodexTranscript({
  activeThreadId,
  fillHeight,
}: {
  activeThreadId: string;
  fillHeight: boolean;
}) {
  const { t } = useTranslation("thread");
  const loading = useCodexStore((s) => s.historyLoadingMap[activeThreadId]);
  const loaded = useCodexStore((s) => s.historyLoadedMap[activeThreadId]);
  const earlierCursor = useSessionSyncStore((s) => s.cursors[activeThreadId]);
  const earlierLoading = useSessionSyncStore(
    (s) => s.earlierLoading[activeThreadId],
  );
  const earlierError = useSessionSyncStore(
    (s) => s.earlierErrors[activeThreadId],
  );
  const historyError = useCodexStore((s) => s.historyErrorMap[activeThreadId]);
  const events = useCodexStore((s) => s.events[activeThreadId] ?? EMPTY_EVENTS);
  const streamingMessage = useCodexStore(
    (s) => s.streamingAgentMessages?.[activeThreadId],
  );
  const turnTiming = useCodexStore((s) => s.turnTimingMap[activeThreadId]);
  const retryNotice = useCodexStore((s) => s.retryNoticeMap[activeThreadId]);
  const rows = useMemo(() => buildThreadRows(events), [events]);
  const rootRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  useSessionReadReceipt("codex", activeThreadId, latestRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const saved = useRef(positions.get(activeThreadId));
  const reading = useRef<ReadingPosition | undefined>(
    getReadingPosition(`codex:${activeThreadId}`),
  );
  const userScrolling = useRef(false);
  const disclosure = useRef(
    saved.current?.disclosure ?? new Map<string, Map<string, unknown>>(),
  );
  const pinned = useRef(reading.current?.atBottom ?? true);
  const restoringAnchor = useRef(!pinned.current && !!reading.current?.anchor);
  const [isAtBottom, setAtBottom] = useState(pinned.current);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const newest = useRef<string | undefined>(undefined);
  useEffect(() => {
    const last = rows.at(-1);
    const signature = last?.key;
    if (newest.current && signature !== newest.current && !pinned.current)
      setHasNewMessages(true);
    newest.current = signature;
  }, [rows]);
  const viewport = useCallback(
    () =>
      rootRef.current?.querySelector<HTMLDivElement>(
        '[data-slot="scroll-area-viewport"]',
      ) ?? null,
    [],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: viewport,
    estimateSize: () => 160,
    observeElementRect: (instance, callback) => {
      if (!instance.scrollElement) return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.height > 0)
          callback({ width: rect.width, height: rect.height });
      });
      observer.observe(instance.scrollElement);
      return () => observer.disconnect();
    },
    // ResizeObserver supplies a measured border box without forcing synchronous layout.
    measureElement: (element, entry, instance) =>
      entry?.borderBoxSize?.[0]?.blockSize ||
      instance.measurementsCache[Number(element.getAttribute("data-index"))]
        ?.size ||
      160,
    initialMeasurementsCache:
      saved.current?.width === window.innerWidth
        ? saved.current.measurements
        : [],
    getItemKey: (index) => rows[index].key,
    overscan: 2,
    initialRect: { width: 768, height: 600 },
    initialOffset: () =>
      pinned.current
        ? Math.max(0, rows.length * 160 - 600)
        : (reading.current?.scrollTop ?? 0),
  });
  useEffect(() => {
    const visibleKeys = new Set(
      virtualizer
        .getVirtualItems()
        .map((item) => rows[item.index]?.key)
        .filter((key): key is string => !!key),
    );
    pruneRowState(
      disclosure.current,
      rows.map((row) => row.key),
      visibleKeys,
    );
  }, [rows, virtualizer]);
  // Preserve the reading anchor when an earlier row changes height (images/code/resize).
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) =>
    !pinned.current && item.start < (virtualizer.scrollOffset ?? 0);
  const jumpToBottom = useCallback(() => {
    pinned.current = true;
    restoringAnchor.current = false;
    userScrolling.current = false;
    setAtBottom(true);
    setHasNewMessages(false);
    const element = viewport();
    // WebKit binds scrollTop to a signed integer: huge sentinel values can wrap
    // negative and land at the top. Always use the actual, bounded scroll range.
    if (element)
      element.scrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
  }, [viewport]);

  useEffect(() => {
    const locate = (event: Event) => {
      const target = (event as CustomEvent<{ kind: string; id: string }>)
        .detail;
      if (target?.kind === "codex" && target.id === activeThreadId)
        jumpToBottom();
    };
    window.addEventListener("session-locate-request", locate);
    const submitted = (event: Event) => {
      if (
        (event as CustomEvent<{ threadId: string }>).detail?.threadId ===
          activeThreadId &&
        useCodexStore.getState().currentThreadId === activeThreadId
      )
        jumpToBottom();
    };
    window.addEventListener("session-message-submitted", submitted);
    return () => {
      window.removeEventListener("session-locate-request", locate);
      window.removeEventListener("session-message-submitted", submitted);
    };
  }, [activeThreadId, jumpToBottom]);

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (pinned.current || userScrolling.current || !reading.current?.anchor)
      return;
    const index = rows.findIndex((row) => row.key === reading.current?.anchor);
    const element = viewport();
    if (index < 0 || !element) {
      if (rows.length && earlierCursor && !earlierLoading && !earlierError)
        void codexService.loadEarlierHistory(activeThreadId);
      return;
    }
    const measurement = virtualizer.measurementsCache[index];
    const anchor = reading.current.anchor;
    let frame = 0,
      attempts = 0;
    restoringAnchor.current = true;
    const align = () => {
      if (pinned.current || reading.current?.anchor !== anchor) return;
      const node = [
        ...element.querySelectorAll<HTMLElement>("[data-codex-row]"),
      ].find((row) => row.dataset.codexRow === anchor);
      if (node) {
        if (reading.current.format === "row")
          element.scrollTop +=
            node.getBoundingClientRect().top -
            element.getBoundingClientRect().top +
            reading.current.offset;
        else if (measurement)
          element.scrollTop = Math.max(
            0,
            measurement.start + reading.current.offset,
          );
        reading.current = {
          ...reading.current,
          format: "row",
          offset:
            reading.current.format === "row"
              ? reading.current.offset
              : element.getBoundingClientRect().top -
                node.getBoundingClientRect().top,
          scrollTop: element.scrollTop,
        };
        frame = requestAnimationFrame(() => {
          restoringAnchor.current = false;
          if (reading.current)
            saveReadingPosition(`codex:${activeThreadId}`, reading.current);
        });
      } else if (measurement && attempts++ < 4) {
        restoringAnchor.current = true;
        element.scrollTop = Math.max(
          0,
          measurement.start + reading.current.offset,
        );
        frame = requestAnimationFrame(align);
      }
    };
    align();
    return () => cancelAnimationFrame(frame);
  }, [
    rows,
    totalSize,
    viewport,
    virtualizer,
    earlierCursor,
    earlierLoading,
    earlierError,
    activeThreadId,
  ]);
  useEffect(() => {
    if (!pinned.current) return;
    const frame = requestAnimationFrame(() => {
      if (pinned.current) jumpToBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, totalSize, jumpToBottom]);
  useLayoutEffect(() => {
    const element = viewport();
    if (!element) return;
    let followFrame = 0;
    let saveTimer: ReturnType<typeof setTimeout>;
    let rememberFrame = 0;
    const remember = (persist = true) => {
      if (restoringAnchor.current) return;
      if (
        !userScrolling.current &&
        !pinned.current &&
        reading.current?.anchor
      ) {
        if (persist)
          saveReadingPosition(`codex:${activeThreadId}`, reading.current);
        return;
      }
      const top = element.getBoundingClientRect().top;
      const node = [
        ...element.querySelectorAll<HTMLElement>("[data-codex-row]"),
      ].find(
        (row) =>
          row.getBoundingClientRect().bottom > top &&
          row.getBoundingClientRect().top < top + element.clientHeight,
      );
      if (!node) return;
      reading.current = {
        atBottom: pinned.current,
        anchor: node?.dataset.codexRow ?? reading.current?.anchor,
        offset: node
          ? top - node.getBoundingClientRect().top
          : (reading.current?.offset ?? 0),
        scrollTop: element.scrollTop,
        format: "row",
      };
      if (persist)
        saveReadingPosition(`codex:${activeThreadId}`, reading.current);
    };
    let touchStart: { x: number; y: number } | null = null;
    const onScroll = () => {
      if (element.clientHeight === 0) return;
      if (restoringAnchor.current) return;
      // Layout/measurement scroll events must not cancel following the latest message.
      if (pinned.current && !userScrolling.current) {
        // Mobile focus/keyboard and virtual-list layout can move the viewport.
        // A tap is not permission to abandon following the latest reply.
        if (
          element.scrollHeight - element.scrollTop - element.clientHeight >
          4
        ) {
          cancelAnimationFrame(followFrame);
          followFrame = requestAnimationFrame(() => {
            if (pinned.current && !userScrolling.current) jumpToBottom();
          });
        }
        return;
      }
      const atBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 4;
      pinned.current = atBottom;
      if (atBottom) userScrolling.current = false;
      setAtBottom(atBottom);
      remember(false);
      cancelAnimationFrame(rememberFrame);
      rememberFrame = requestAnimationFrame(() => remember(false));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        remember();
        userScrolling.current = false;
      }, 150);
    };
    const markUserScroll = () => {
      userScrolling.current = true;
      restoringAnchor.current = false;
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !touchStart) return;
      const dy = Math.abs(touch.clientY - touchStart.y);
      if (dy > 8 && dy > Math.abs(touch.clientX - touchStart.x))
        markUserScroll();
    };
    const onTouchEnd = () => {
      touchStart = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        markUserScroll();
    };
    const onPointer = (event: PointerEvent) => {
      // Only a mouse scrollbar drag counts; clicking text/buttons and touch taps do not.
      if (
        event.pointerType === "mouse" &&
        event.target === element &&
        event.clientX >=
          element.getBoundingClientRect().left + element.clientWidth
      )
        markUserScroll();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", markUserScroll, { passive: true });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchEnd, { passive: true });
    element.addEventListener("keydown", onKey);
    rootRef.current?.addEventListener("pointerdown", onPointer);
    const root = rootRef.current;
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", markUserScroll);
      cancelAnimationFrame(followFrame);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
      element.removeEventListener("keydown", onKey);
      root?.removeEventListener("pointerdown", onPointer);
      clearTimeout(saveTimer);
      remember();
      cancelAnimationFrame(rememberFrame);
      positions.delete(activeThreadId);
      if (isCodexTranscriptDormant(activeThreadId)) return;
      positions.set(activeThreadId, {
        measurements:
          virtualizer.measurementsCache.length <= 3000
            ? [...virtualizer.measurementsCache]
            : [],
        width: window.innerWidth,
        disclosure: disclosure.current,
      });
      if (positions.size > 50) positions.delete(positions.keys().next().value!);
    };
  }, [activeThreadId, viewport, virtualizer, jumpToBottom]);
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!pinned.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pinned.current) jumpToBottom();
      });
    });
    const element = viewport();
    if (element) observer.observe(element);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [jumpToBottom, viewport]);

  return (
    <div
      className={`relative flex-1 flex flex-col min-h-0 ${fillHeight ? "h-full" : ""}`}
    >
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea ref={rootRef} className="h-full px-4 pb-4">
          <div
            ref={contentRef}
            className="thread-surface max-w-3xl mx-auto py-4"
          >
            {earlierCursor && (
              <div className="session-earlier-history">
                <button
                  type="button"
                  disabled={earlierLoading}
                  onClick={() =>
                    void codexService.loadEarlierHistory(activeThreadId)
                  }
                >
                  {earlierLoading ? "正在加载更早消息…" : "加载更早消息"}
                </button>
                {earlierError && <span role="status">加载失败，可重试</span>}
              </div>
            )}
            <div
              style={{
                height: totalSize,
                position: "relative",
                overflowAnchor: "none",
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                let state = disclosure.current.get(rows[item.index].key);
                if (!state) {
                  state = new Map();
                  disclosure.current.set(rows[item.index].key, state);
                }
                return (
                  <div
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    data-codex-row={rows[item.index].key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 8,
                    }}
                  >
                    <RowStateContext.Provider value={state}>
                      <ThreadMessage row={rows[item.index]} />
                    </RowStateContext.Provider>
                  </div>
                );
              })}
            </div>
            {streamingMessage && (
              <div className="py-1" data-codex-live-message>
                <AgentMessageItem
                  text=""
                  threadId={activeThreadId}
                  itemId={streamingMessage.itemId}
                  streaming
                  streamingSegments={
                    streamingMessage.preview
                      ? undefined
                      : streamingMessage.segments
                  }
                  streamingCurrent={streamingMessage.current}
                  streamingPreview={streamingMessage.preview}
                />
              </div>
            )}
            <div className="space-y-2">
              <CodexDeliveryEchoes threadId={activeThreadId} events={events} />
              {loading && !loaded && events.length === 0 && (
                <div
                  role="status"
                  className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
                >
                  <Loader2 className="size-4 animate-spin" />
                  {t("historyLoading")}
                </div>
              )}
              {historyError &&
                !loading &&
                (!loaded || needsCodexTranscriptRestore(activeThreadId)) &&
                events.length === 0 && (
                  <div
                    role="alert"
                    className="rounded-md border p-3 text-sm space-y-2"
                  >
                    <p>
                      {t("historyFailed")}: {historyError}
                    </p>
                    <button
                      className="text-primary underline underline-offset-4"
                      onClick={() => {
                        void codexService
                          .loadThreadHistory(activeThreadId, undefined, {
                            background: true,
                            recent: true,
                          })
                          .catch(() => {});
                      }}
                    >
                      {t("historyRetry")}
                    </button>
                  </div>
                )}
              <ApprovalItem currentThreadId={activeThreadId} />
              <WorkingIndicator
                turnTiming={turnTiming}
                retryNotice={retryNotice}
              />
              <RequestUserInputItem currentThreadId={activeThreadId} />
              <ElicitationItem currentThreadId={activeThreadId} />
              <PermissionsItem currentThreadId={activeThreadId} />
              <div ref={latestRef} data-session-latest style={{ height: 1 }} />
            </div>
          </div>
        </ScrollArea>
      </div>
      <CodexAccessNotice key={activeThreadId} threadId={activeThreadId} />
      {!isAtBottom && (
        <ScrollToBottomButton
          onClick={jumpToBottom}
          bottomClassName="bottom-4"
          label={hasNewMessages ? "有新消息" : "回到最新"}
        />
      )}
    </div>
  );
});

export const CodexThread = memo(function CodexThread({
  threadId,
  fillHeight = true,
  inspection = false,
}: CodexThreadProps = {}) {
  const activeThreadId = useCodexStore((s) => threadId ?? s.currentThreadId);
  const { ref, renderTranscript } = useTranscriptVisibility(
    activeThreadId ?? "",
  );
  return (
    <TranscriptInspectionContext.Provider value={inspection}>
      <div
        ref={ref}
        data-codex-transcript-shell={activeThreadId ?? ""}
        className={`flex flex-col flex-1 min-h-0 ${fillHeight ? "h-full" : ""}`}
      >
        {renderTranscript ? (
          <CodexTranscript
            key={activeThreadId ?? ""}
            activeThreadId={activeThreadId ?? ""}
            fillHeight={fillHeight}
          />
        ) : (
          <div className="flex-1 min-h-0" data-transcript-sleeping />
        )}
      </div>
    </TranscriptInspectionContext.Provider>
  );
});
