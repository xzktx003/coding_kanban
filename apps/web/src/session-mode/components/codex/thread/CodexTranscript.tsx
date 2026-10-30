import { CodexProtocolRecords } from "./CodexProtocolRecords";
import { ThreadSources } from "@session/features/sources/ThreadSources";
import { CodexSystemRecords } from "./CodexSystemRecords";
import { countClosedThreadRecords } from "./closedThreadRecords";
import {
  hasEarlierHistory,
  shouldLoadEarlierOnScroll,
} from "./earlierHistoryScroll";
import { pruneRowState } from "./pruneRowState";
import {
  isCodexTranscriptDormant,
  needsCodexTranscriptRestore,
  onCodexTranscriptReleased,
  retainPreparedCodexTranscript,
} from "@session/services/codexTranscriptActivity";
import { CodexAccessNotice } from "./CodexAccessNotice";
import { CodexHistoryNotice } from "./CodexHistoryNotice";
import { useSessionReadReceipt } from "@session/hooks/useSessionReadReceipt";
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
import { flushSync } from "react-dom";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "@session/components/codex/stores";
import { ScrollArea } from "@session/components/ui/scroll-area";
import { EventItem } from "../items";
import { MessageTimestamp } from "../items/MessageTimestamp";
import { AgentMessageItem } from "../items/AgentMessageItem";
import { ApprovalItem } from "../items/ApprovalItem";
import { CommandActionSummaryItem } from "../items/CommandActionSummaryItem";
import { ElicitationItem } from "../items/ElicitationItem";
import { PermissionsItem } from "../items/PermissionsItem";
import { RequestUserInputItem } from "../items/RequestUserInputItem";
import { ScrollToBottomButton } from "../widget/ScrollToBottomButton";
import { WorkingIndicator } from "../widget/WorkingIndicator";
import { RowStateContext } from "./rowState";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities, type ActivityDisplayRow } from "./activityRows";
import {
  ActivityEntryView,
  NativeActivityGroup,
} from "../items/NativeActivityGroup";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useShallow } from "zustand/react/shallow";
import { CodexDeliveryEchoes } from "./CodexDeliveryEchoes";
import {
  getReadingPosition,
  saveReadingPosition,
  type ReadingPosition,
} from "@session/services/sessionTranscriptCache";
import {
  requestSessionHistorySync,
  useSessionSyncStore,
} from "@session/stores/useSessionSyncStore";
import {
  projectWorkflowRows,
  latestAssistantActionRow,
} from "./projectWorkflowRows";
import {
  ThreadWorkflowToolbar,
  ThreadUserNavigationRail,
} from "@session/features/thread-workflows/ThreadWorkflowToolbar";
import { visibleTurnIds } from "@session/features/thread-workflows/visibleTurns";
import type {
  WorkflowAnchor,
  ThreadSearchMatch,
} from "@session/features/thread-workflows/model";
import {
  flashRowWhenMounted,
  prefersReducedMotion,
} from "@session/features/thread-workflows/userMessageReveal";
import {
  projectNativeHookRuns,
  projectNativeCompletedHookTurns,
  nativeHookRunsForTurn,
} from "../presentation/nativeHookRuns";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import {
  threadWorkflowActions,
  useThreadWorkflowActions,
} from "@session/features/thread-workflows/actions";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "@session/session-dom";
import { threadFindKeyIntent } from "./threadFindKeys";
import { useThreadLinkStore } from "@session/features/thread-workflows/threadLinkStore";
import { findTurnRowIndex } from "./turnNavigation";
import { projectTurnWork, type TranscriptWorkRow } from "./turnWork";
import { TurnWorkHeader } from "./TurnWorkHeader";
import {
  measureTranscriptRow,
  shouldAdjustTranscriptRow,
} from "./measureTranscriptRow";
import { isTranscriptScrollKey } from "./transcriptScrollKeys";
import { prepareThreadSearchMatch } from "./prepareThreadSearchMatch";
import { captureTranscriptReadingPosition } from "./transcriptReadingPosition";
import {
  GoalCompletionScope,
  GoalCompletionFallback,
  useGoalCompletionTarget,
} from "@session/features/goals/GoalCompletionBadge";
import { goalCompletionFallbackSlot } from "@session/features/goals/goalCompletionSlots";
import { useGoalAnnouncements } from "@session/features/goals/goalTranscript";
import { projectGoalTranscriptSlots } from "@session/features/goals/goalTranscriptProjection";
import { GoalTranscriptAnnouncements } from "@session/features/goals/GoalTranscriptAnnouncements";
import {
  findTranscriptMatchRange,
  setTranscriptSearchHighlight,
} from "./threadSearchHighlight";

const EMPTY_EVENTS: ServerNotification[] = [];
// Only a starting estimate; every mounted row still measures its real height.
const TRANSCRIPT_ESTIMATED_ROW_HEIGHT = 280;
const positions = new Map<
  string,
  {
    measurements: VirtualItem[];
    width: number;
    disclosure: Map<string, Map<string, unknown>>;
    openedWork?: Set<string>;
  }
>();
// The cache owns only disposable view state. Unmount may follow the release
// notification, so its cleanup must also avoid writing a dormant entry back.
const stopPositionCleanup = onCodexTranscriptReleased((id) =>
  positions.delete(id),
);
if (import.meta.hot) import.meta.hot.dispose(stopPositionCleanup);
const ThreadMessage = memo(
  function ThreadMessage({
    row,
    nativeEditUser = false,
    alwaysShowAssistantActions = false,
    hookRuns,
    onToggleWork,
    retryNotice,
  }: {
    row: TranscriptWorkRow;
    nativeEditUser?: boolean;
    alwaysShowAssistantActions?: boolean;
    hookRuns?: readonly HookRunSummary[];
    onToggleWork?: (key: string) => void;
    retryNotice?: string;
  }) {
    if (row.work)
      return (
        <TurnWorkHeader
          work={row.work}
          retryNotice={retryNotice}
          onToggle={() => onToggleWork?.(row.key)}
        />
      );
    if (row.activity) return <NativeActivityGroup group={row.activity} />;
    if (row.activityEntry)
      return <ActivityEntryView entry={row.activityEntry} />;
    const item = row.item;
    return item.kind === "cmdGroup" ? (
      <CommandActionSummaryItem
        actions={item.actions}
        actionSources={item.actionSources}
        completed={item.completed}
      />
    ) : (
      <EventItem
        event={item.event}
        context={row.context}
        nativeEditUser={nativeEditUser}
        alwaysShowAssistantActions={alwaysShowAssistantActions}
        hookRuns={hookRuns}
      />
    );
  },
  (before, after) => {
    if (
      before.onToggleWork !== after.onToggleWork ||
      before.retryNotice !== after.retryNotice
    )
      return false;
    if (before.row.work || after.row.work)
      return before.row.work === after.row.work;
    if (before.nativeEditUser !== after.nativeEditUser) return false;
    if (before.alwaysShowAssistantActions !== after.alwaysShowAssistantActions)
      return false;
    if (before.hookRuns !== after.hookRuns) return false;
    if (before.row === after.row) return true;
    if (before.row.activity || after.row.activity)
      return before.row.activity === after.row.activity;
    return (
      before.row.item.kind === "event" &&
      after.row.item.kind === "event" &&
      before.row.item.event === after.row.item.event &&
      before.row.context?.rollbackTurns === after.row.context?.rollbackTurns &&
      before.row.context?.renderTermination ===
        after.row.context?.renderTermination &&
      before.row.context?.messageTimestamp?.ms ===
        after.row.context?.messageTimestamp?.ms &&
      before.row.context?.messageTimestamp?.label ===
        after.row.context?.messageTimestamp?.label &&
      before.row.context?.events === after.row.context?.events
    );
  },
);

const CodexTranscript = memo(function CodexTranscript({
  activeThreadId,
  fillHeight,
  inspection,
}: {
  activeThreadId: string;
  fillHeight: boolean;
  inspection: boolean;
}) {
  // Foreground structure has committed; background body warm-up may now run.
  // History readiness remains a separate native/cache state.
  useEffect(() => activeThreadId ? retainPreparedCodexTranscript(activeThreadId) : undefined, [activeThreadId]);
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
  const earlierTrimmedAnchor = useSessionSyncStore(
    (s) => s.trimmedHistoryAnchors[activeThreadId],
  );
  const earlierAvailable = hasEarlierHistory({
    cursor: earlierCursor,
    trimmedAnchor: earlierTrimmedAnchor,
  });
  const historyError = useCodexStore((s) => s.historyErrorMap[activeThreadId]);
  const events = useCodexStore((s) => s.events[activeThreadId] ?? EMPTY_EVENTS);
  const goalAnnouncements = useGoalAnnouncements(activeThreadId);
  const completionTarget = useGoalCompletionTarget(activeThreadId);
  const closedRecordCount = useMemo(
    () => countClosedThreadRecords(events, activeThreadId),
    [events, activeThreadId],
  );
  const streamingMessage = useCodexStore(
    (s) => s.streamingAgentMessages?.[activeThreadId],
  );
  const turnTiming = useCodexStore((s) => s.turnTimingMap[activeThreadId]);
  const completedHookTurns = useMemo(() => {
    const keys = projectNativeCompletedHookTurns(events);
    if (turnTiming && turnTiming.status !== "inProgress")
      keys.add(JSON.stringify([activeThreadId, turnTiming.turnId]));
    return keys;
  }, [events, activeThreadId, turnTiming?.turnId, turnTiming?.status]);
  const previousHooks = useRef(new Map<string, readonly HookRunSummary[]>());
  const hooks = useMemo(() => {
    const next = projectNativeHookRuns(events);
    for (const [key, runs] of next) {
      const previous = previousHooks.current.get(key);
      if (
        previous &&
        previous.length === runs.length &&
        previous.every((run, index) => run === runs[index])
      )
        next.set(key, previous);
    }
    previousHooks.current = next;
    return next;
  }, [events]);
  const rowHooks = (row: TranscriptWorkRow) => {
    if (row.work) return;
    if (row.item.kind !== "event") return;
    const params = row.item.event.params;
    if ("threadId" in params && "turnId" in params && params.turnId)
      return nativeHookRunsForTurn(
        hooks,
        params.threadId,
        params.turnId,
        { ...runtime, threadId: activeThreadId },
        completedHookTurns,
      );
  };
  const runtime = useCodexStore(
    useShallow((state) => codexRuntimeState(state, activeThreadId)),
  );
  const retryNotice = useCodexStore((s) => s.retryNoticeMap[activeThreadId]);
  const activityRows = useMemo(
    () =>
      groupThreadActivities(buildThreadRows(events), events, {
        threadId: activeThreadId,
        running: runtime.running,
        turnId: runtime.turnId,
        terminal:
          turnTiming && turnTiming.status !== "inProgress"
            ? { turnId: turnTiming.turnId, status: turnTiming.status }
            : undefined,
      }),
    [
      events,
      activeThreadId,
      runtime.running,
      runtime.turnId,
      turnTiming?.turnId,
      turnTiming?.status,
    ],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const workflow = useMemo(
    () => projectWorkflowRows(activeThreadId, activityRows, events),
    [activeThreadId, activityRows, events],
  );
  const latestWorkflow = useRef({
    threadId: activeThreadId,
    messages: workflow.messages,
    rows: activityRows as TranscriptWorkRow[],
  });
  latestWorkflow.current = {
    threadId: activeThreadId,
    messages: workflow.messages,
    rows: activityRows as TranscriptWorkRow[],
  };
  const title = useCodexStore(
    (state) =>
      state.threads.find((thread) => thread.id === activeThreadId)?.name,
  );
  const [navigation, setNavigation] = useState<WorkflowAnchor | null>(null);
  const searchPanel = useThreadWorkflowActions(
    (state) => state.panels[activeThreadId],
  );
  const linkedTurn = useThreadLinkStore((state) => state.target);
  const interactionVisible = useAgentInteractionVisible();
  // Subscribe to one primitive native identity, never the snapshot's turns/items.
  const snapshotLastTurnId = useCodexStore(
    (state) =>
      state.threads
        .find((thread) => thread.id === activeThreadId)
        ?.turns?.at(-1)?.id,
  );
  const persistentAssistantRowId =
    !inspection && interactionVisible && !streamingMessage
      ? latestAssistantActionRow(
          workflow,
          [runtime.turnId, turnTiming?.turnId, snapshotLastTurnId],
          runtime.running && !runtime.turnId,
        )
      : undefined;
  const inputThreadId = useCodexStore((state) => state.currentThreadId);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const intent = threadFindKeyIntent(event),
        ownerRoot = rootRef.current?.closest(
          ".codex-presentation",
        ) as HTMLElement | null;
      if (
        intent === null ||
        !ownerRoot ||
        !isAgentInteractionVisible() ||
        !ownerRoot.getClientRects().length
      )
        return;
      if (
        !(event.target instanceof Node && ownerRoot.contains(event.target)) &&
        useCodexStore.getState().currentThreadId !== activeThreadId
      )
        return;
      for (
        let element: HTMLElement | null = ownerRoot;
        element;
        element = element.parentElement
      )
        if (
          element.hidden ||
          element.hasAttribute("inert") ||
          getComputedStyle(element).display === "none"
        )
          return;
      if (
        intent !== "open" &&
        useThreadWorkflowActions.getState().panels[activeThreadId] !== "search"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (intent === "open")
        threadWorkflowActions.request(activeThreadId, "search", {
          focus: true,
          ownerRoot,
        });
      else threadWorkflowActions.move(activeThreadId, intent, { ownerRoot });
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [activeThreadId]);
  const latestRef = useRef<HTMLDivElement>(null);
  useSessionReadReceipt("codex", activeThreadId, latestRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const rowListRef = useRef<HTMLDivElement>(null);
  const [rowScrollMargin, setRowScrollMargin] = useState(0);
  const saved = useRef(positions.get(activeThreadId));
  const [initialReading] = useState(() =>
    getReadingPosition(`codex:${activeThreadId}`),
  );
  const reading = useRef<ReadingPosition | undefined>(initialReading);
  const [openedWork, setOpenedWork] = useState(
    () => saved.current?.openedWork ?? new Set<string>(),
  );
  const openedWorkRef = useRef(openedWork);
  openedWorkRef.current = openedWork;
  const readingAnchor =
    reading.current?.atBottom === false ? reading.current.anchor : undefined;
  const rows = useMemo(() => {
    const display = projectTurnWork(
      activityRows,
      events,
      turnTiming,
      openedWork,
      activeThreadId,
      streamingMessage
        ? {
            threadId: activeThreadId,
            turnId: streamingMessage.turnId,
            itemId: streamingMessage.itemId,
          }
        : undefined,
    );
    const hiddenAnchor =
      readingAnchor &&
      display.find(
        (row) => row.work?.processKeys.has(readingAnchor) && !row.work.expanded,
      );
    if (hiddenAnchor)
      return projectTurnWork(
        activityRows,
        events,
        turnTiming,
        new Set([...openedWork, hiddenAnchor.key]),
        activeThreadId,
        streamingMessage
          ? {
              threadId: activeThreadId,
              turnId: streamingMessage.turnId,
              itemId: streamingMessage.itemId,
            }
          : undefined,
      );
    return display;
  }, [
    activityRows,
    events,
    turnTiming,
    openedWork,
    activeThreadId,
    readingAnchor,
    streamingMessage?.turnId,
    streamingMessage?.itemId,
  ]);
  latestWorkflow.current = {
    threadId: activeThreadId,
    messages: workflow.messages,
    rows,
  };
  const goalSlots = useMemo(
    () =>
      projectGoalTranscriptSlots(
        activeThreadId,
        rows,
        goalAnnouncements,
        events,
      ),
    [activeThreadId, rows, goalAnnouncements, events],
  );
  const completionSlot = useMemo(
    () =>
      goalCompletionFallbackSlot(
        activeThreadId,
        completionTarget,
        rows,
        events,
      ),
    [activeThreadId, completionTarget, rows, events],
  );
  const userScrolling = useRef(false);
  const disclosure = useRef(
    saved.current?.disclosure ?? new Map<string, Map<string, unknown>>(),
  );
  const pinned = useRef(reading.current?.atBottom ?? true);
  const readingAway = useRef(!pinned.current);
  const restoringAnchor = useRef(!pinned.current && !!reading.current?.anchor);
  const pendingEarlierAnchor = useRef<string | undefined>(undefined);
  const [isAtBottom, setAtBottom] = useState(pinned.current);
  const [readerBufferEnabled, setReaderBufferEnabled] = useState(
    !pinned.current,
  );
  const readerBufferEnabledRef = useRef(!pinned.current);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const newest = useRef<string | undefined>(undefined);
  const lastGoalAnnouncementKey = goalAnnouncements.at(-1)?.key;
  useEffect(() => {
    const last = rows.at(-1);
    // Keep only identities/revisions here, never a serialized message or tool
    // result. Live output is outside retained rows and needs its own revision.
    const nativeSignature = streamingMessage
      ? `live-${streamingMessage.turnId}-${streamingMessage.itemId}-${streamingMessage.length}`
      : last?.activity
        ? `${last.key}:${last.activity.revision}`
        : last?.key;
    const signature = lastGoalAnnouncementKey
      ? `${nativeSignature ?? ""}:${lastGoalAnnouncementKey}`
      : nativeSignature;
    if (newest.current && signature !== newest.current && !pinned.current)
      setHasNewMessages(true);
    newest.current = signature;
  }, [rows, streamingMessage, lastGoalAnnouncementKey]);
  const viewport = useCallback(
    () =>
      rootRef.current?.querySelector<HTMLDivElement>(
        '[data-slot="scroll-area-viewport"]',
      ) ?? null,
    [],
  );
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const updateRowScrollMargin = useCallback(() => {
    const element = viewport();
    const list = rowListRef.current;
    if (!element || !list) return;
    setRowScrollMargin(
      Math.max(
        0,
        list.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop,
      ),
    );
  }, [viewport]);
  // Padding and earlier-history/Goal content precede the virtual rows. Use
  // their actual origin so the range includes every physically visible row.
  useLayoutEffect(updateRowScrollMargin, [
    updateRowScrollMargin,
    earlierAvailable,
    earlierLoading,
    earlierError,
    goalSlots.before,
    completionTarget,
    completionSlot?.afterRow,
  ]);
  useLayoutEffect(() => {
    const element = viewport();
    const content = contentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(updateRowScrollMargin);
    observer.observe(element);
    observer.observe(content, { box: "border-box" });
    return () => observer.disconnect();
  }, [viewport, updateRowScrollMargin]);
  const measuredRowNodes = useRef(new WeakSet<Element>());
  const rowMeasurement = useRef<{
    key: VirtualItem["key"] | undefined;
    firstDomMeasurement: boolean;
  } | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: viewport,
    estimateSize: () => TRANSCRIPT_ESTIMATED_ROW_HEIGHT,
    observeElementRect: (instance, callback) => {
      if (!instance.scrollElement) return;
      let frame = 0;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect || rect.height <= 0) return;
        // Viewport changes can rerender measured rows and resize the viewport
        // again. Schedule this boundary outside observer delivery, while row
        // measurements remain synchronous to preserve the reading anchor.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          callback({ width: rect.width, height: rect.height }),
        );
      });
      observer.observe(instance.scrollElement);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
    },
    // A new row needs its real height before paint; observer delivery keeps using
    // the supplied border box without requesting another layout.
    measureElement: (element, entry, instance) => {
      const previous =
        instance.measurementsCache[Number(element.getAttribute("data-index"))];
      rowMeasurement.current = {
        key: previous?.key,
        firstDomMeasurement: !entry && !measuredRowNodes.current.has(element),
      };
      measuredRowNodes.current.add(element);
      return measureTranscriptRow(element, entry, previous?.size);
    },
    initialMeasurementsCache:
      saved.current?.width === window.innerWidth
        ? saved.current.measurements
        : [],
    getItemKey,
    scrollMargin: rowScrollMargin,
    // First let a reader's actual scroll reach the virtualizer. Mounting its
    // buffer during wheel delivery can compensate against the old tail offset.
    overscan: readerBufferEnabled ? 2 : 0,
    initialRect: { width: 768, height: 600 },
    initialOffset: () =>
      pinned.current
        ? Math.max(0, rows.length * TRANSCRIPT_ESTIMATED_ROW_HEIGHT - 600)
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
      // A collapsed turn still owns its activity disclosures. Retain those
      // keys while their source rows exist, within the same bounded cache.
      [...activityRows, ...rows].map((row) => row.key),
      visibleKeys,
    );
  }, [activityRows, rows, virtualizer]);
  /**
   * Turns on screen right now, which the prompt rail marks `aria-current`. The
   * shipped webview keeps an IntersectionObserver over the transcript for this;
   * our rows are virtualized, so their own offsets already carry it and a
   * second observer would only race the virtualizer. Read during render like
   * `getVirtualItems()` elsewhere here, so the markers move with the scroll
   * rather than a frame behind it.
   */
  const visibleTurns = visibleTurnIds(
    virtualizer.getVirtualItems().map((item) => ({
      start: item.start,
      end: item.end,
      turnId: workflow.turnIdByRowId.get(rows[item.index]?.key ?? ""),
    })),
    {
      scrollOffset: virtualizer.scrollOffset ?? 0,
      height: virtualizer.scrollRect?.height ?? 0,
    },
  );
  // Compensate rows entirely above the reader. Growing the partly visible row
  // itself must keep its top fixed, rather than jumping by its added height.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta) => {
    // The core calls this synchronously after measureElement. A new DOM row's
    // estimate can overlap the reader even when its actual short box is above.
    // Existing DOM rows keep the old-end rule so partial rows keep their top.
    const measurement = rowMeasurement.current;
    rowMeasurement.current = null;
    return (
      !pinned.current &&
      shouldAdjustTranscriptRow(
        item.end,
        delta,
        virtualizer.scrollOffset ?? 0,
        measurement?.key === item.key && measurement.firstDomMeasurement,
      )
    );
  };
  // At the very top the saved anchor can already be virtualized away, and the
  // restore effect can then neither find its row nor measure it, so a prepended
  // page silently takes over the viewport. Re-anchor to a mounted row first.
  const anchorBeforeEarlierLoad = useCallback(() => {
    const element = viewport();
    if (!element || pinned.current) return;
    const fresh = captureTranscriptReadingPosition(
      element,
      false,
      reading.current,
    );
    if (!fresh?.anchor) return;
    reading.current = fresh;
    saveReadingPosition(`codex:${activeThreadId}`, fresh);
    // A wheel gesture is still "scrolling" when the page arrives, which would
    // otherwise make the restore effect decline to hold this anchor.
    pendingEarlierAnchor.current = fresh.anchor;
  }, [viewport, activeThreadId]);
  const jumpToBottom = useCallback(() => {
    pinned.current = true;
    readingAway.current = false;
    restoringAnchor.current = false;
    pendingEarlierAnchor.current = undefined;
    userScrolling.current = false;
    setAtBottom(true);
    readerBufferEnabledRef.current = false;
    setReaderBufferEnabled(false);
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
  const toggleWork = useCallback(
    (key: string) => {
      const element = viewport();
      const node =
        element &&
        [...element.querySelectorAll<HTMLElement>("[data-codex-row]")].find(
          (row) => row.dataset.codexRow === key,
        );
      pinned.current = false;
      readingAway.current = true;
      userScrolling.current = false;
      restoringAnchor.current = true;
      setAtBottom(false);
      if (element && node)
        reading.current = {
          atBottom: false,
          anchor: key,
          format: "row",
          scrollTop: element.scrollTop,
          offset:
            element.getBoundingClientRect().top -
            node.getBoundingClientRect().top,
        };
      setOpenedWork((current) => {
        const next = new Set(current);
        const expanded = latestWorkflow.current.rows.find(
          (row) => row.key === key,
        )?.work?.expanded;
        if (expanded) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [viewport],
  );
  /** The rail's post-jump flash, ported from the shipped webview's own reveal. */
  const flashNavigatedRow = useCallback(
    (rowId: string) =>
      flashRowWhenMounted({
        findRow: () =>
          viewport()?.querySelector(
            `[data-codex-row="${CSS.escape(rowId)}"]`,
          ) ?? null,
        reducedMotion: prefersReducedMotion(
          rootRef.current?.ownerDocument.defaultView,
        ),
      }),
    [viewport],
  );
  const navigateToMessage = useCallback(
    (anchor: WorkflowAnchor) => {
      const current = latestWorkflow.current;
      if (current.threadId !== activeThreadId) return;
      const index = current.rows.findIndex((row) => row.key === anchor.rowId);
      if (
        !current.messages.some(
          (message) =>
            message.rowId === anchor.rowId &&
            message.itemId === anchor.itemId &&
            message.turnId === anchor.turnId,
        )
      )
        return;
      const foldedWork =
        index < 0 &&
        current.rows.find((row) => row.work?.processKeys.has(anchor.rowId));
      if (index < 0 && !foldedWork) return;
      pinned.current = false;
      readingAway.current = true;
      userScrolling.current = false;
      restoringAnchor.current = true;
      setAtBottom(false);
      const offset =
        index < 0
          ? (viewport()?.scrollTop ?? 0)
          : (virtualizer.measurementsCache[index]?.start ??
            index * TRANSCRIPT_ESTIMATED_ROW_HEIGHT);
      reading.current = {
        atBottom: false,
        anchor: anchor.rowId,
        offset: 0,
        scrollTop: offset,
        format: "row",
      };
      saveReadingPosition(`codex:${activeThreadId}`, reading.current);
      if (foldedWork) {
        // No flash here on purpose: the rail only targets `role === "user"` rows
        // and `turnWork` never folds a `userMessage`, so this branch is reached
        // by search matches inside a collapsed work group, which have no bubble.
        setOpenedWork((current) => new Set([...current, foldedWork.key]));
        setNavigation({ ...anchor });
        return;
      }
      virtualizer.scrollToIndex(index, { align: "start" });
      setNavigation({ ...anchor });
      flashNavigatedRow(anchor.rowId);
    },
    [
      rows,
      workflow.messages,
      virtualizer,
      activeThreadId,
      viewport,
      flashNavigatedRow,
    ],
  );
  const prepareSearchMatch = useCallback(
    (match: ThreadSearchMatch) => {
      const threadId = activeThreadId;
      const isCurrent = () =>
        latestWorkflow.current.threadId === threadId &&
        !!rootRef.current?.getClientRects().length &&
        isAgentInteractionVisible();
      return prepareThreadSearchMatch({
        threadId,
        match,
        isCurrent,
        getMessages: () => latestWorkflow.current.messages,
        loadCursor: (cursor) =>
          codexService.loadThreadHistory(threadId, undefined, {
            background: true,
            recent: true,
            cursor,
            preserveEarlierCursor: true,
          }),
        waitForLayout: async () => {
          for (let frame = 0; frame < 60 && isCurrent(); frame++) {
            if (
              latestWorkflow.current.messages.some(
                (message) =>
                  message.turnId === match.turnId &&
                  message.itemId === match.itemId,
              )
            )
              return;
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
          }
        },
      });
    },
    [activeThreadId],
  );
  useEffect(() => {
    if (
      !linkedTurn ||
      linkedTurn.threadId !== activeThreadId ||
      inputThreadId !== activeThreadId ||
      !loaded ||
      !interactionVisible ||
      inspection
    )
      return;
    const root = rootRef.current;
    if (!root?.getClientRects().length) return;
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
    const message = workflow.messages.find(
      (message) => message.turnId === linkedTurn.turnId,
    );
    if (message) navigateToMessage(message);
    else {
      const index = findTurnRowIndex(rows, activeThreadId, linkedTurn.turnId);
      if (index < 0) return;
      pinned.current = false;
      readingAway.current = true;
      userScrolling.current = false;
      restoringAnchor.current = true;
      setAtBottom(false);
      const offset =
        virtualizer.measurementsCache[index]?.start ??
        index * TRANSCRIPT_ESTIMATED_ROW_HEIGHT;
      reading.current = {
        atBottom: false,
        anchor: rows[index].key,
        offset: 0,
        scrollTop: offset,
        format: "row",
      };
      saveReadingPosition(`codex:${activeThreadId}`, reading.current);
      virtualizer.scrollToIndex(index, { align: "start" });
      setNavigation(null);
    }
    useThreadLinkStore
      .getState()
      .consumeTarget(activeThreadId, linkedTurn.turnId);
  }, [
    linkedTurn,
    activeThreadId,
    inputThreadId,
    loaded,
    interactionVisible,
    inspection,
    workflow.messages,
    rows,
    navigateToMessage,
    virtualizer,
  ]);
  useEffect(() => {
    const owner = rootRef.current;
    // Only a selected, visible search match needs live DOM reconciliation.
    // Previous effect cleanup releases its range/observer before this guard;
    // ordinary streaming and hidden modes must not schedule empty highlights.
    if (
      !owner ||
      !interactionVisible ||
      searchPanel !== "search" ||
      !navigation?.query
    )
      return;
    let remove = () => {},
      frame = 0;
    const update = () => {
      remove();
      const row =
        navigation &&
        [...owner.querySelectorAll<HTMLElement>("[data-codex-row]")].find(
          (element) => element.dataset.codexRow === navigation.rowId,
        );
      const occurrence = navigation?.occurrence ?? 0;
      remove = setTranscriptSearchHighlight(
        owner,
        searchPanel === "search" && navigation?.query && row
          ? findTranscriptMatchRange(row, navigation.query, occurrence)
          : null,
      );
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(owner, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      remove();
    };
  }, [navigation, searchPanel, activeThreadId, interactionVisible]);
  useLayoutEffect(() => {
    // A page requested from a wheel gesture must still be held in place, so the
    // anchor captured for it outranks the in-progress user-scroll flag.
    const holding =
      !!pendingEarlierAnchor.current &&
      pendingEarlierAnchor.current === reading.current?.anchor;
    if (
      pinned.current ||
      (userScrolling.current && !holding) ||
      !reading.current?.anchor
    )
      return;
    const index = rows.findIndex((row) => row.key === reading.current?.anchor);
    const element = viewport();
    if (index < 0 || !element) {
      if (rows.length && earlierAvailable && !earlierLoading && !earlierError)
        void codexService.loadEarlierHistory(activeThreadId);
      return;
    }
    const measurement = virtualizer.measurementsCache[index];
    const anchor = reading.current.anchor;
    let frame = 0,
      attempts = 0;
    restoringAnchor.current = true;
    const align = () => {
      if (
        pinned.current ||
        (userScrolling.current && !holding) ||
        reading.current?.anchor !== anchor
      )
        return;
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
          if (
            (userScrolling.current && !holding) ||
            reading.current?.anchor !== anchor
          )
            return;
          if (pendingEarlierAnchor.current === anchor)
            pendingEarlierAnchor.current = undefined;
          restoringAnchor.current = false;
          if (reading.current)
            saveReadingPosition(`codex:${activeThreadId}`, reading.current);
        });
        // Prepending a large page remeasures rows for many frames, so a short
        // fixed retry can expire before the anchor row is ever mounted.
      } else if (measurement && attempts++ < (holding ? 60 : 4)) {
        restoringAnchor.current = true;
        element.scrollTop = Math.max(
          0,
          measurement.start + reading.current.offset,
        );
        frame = requestAnimationFrame(align);
      } else if (holding) {
        pendingEarlierAnchor.current = undefined;
        restoringAnchor.current = false;
      }
    };
    align();
    return () => cancelAnimationFrame(frame);
  }, [
    rows,
    totalSize,
    viewport,
    virtualizer,
    earlierAvailable,
    earlierLoading,
    earlierError,
    activeThreadId,
    navigation,
    rowScrollMargin,
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
      const position = captureTranscriptReadingPosition(
        element,
        pinned.current,
        reading.current,
      );
      if (!position) return;
      reading.current = position;
      if (persist)
        saveReadingPosition(`codex:${activeThreadId}`, reading.current);
    };
    let touchStart: { x: number; y: number } | null = null;
    let touchLastY = 0;
    let touchScrolling = false;
    const enableReaderBuffer = () => {
      if (!pinned.current && !readerBufferEnabledRef.current) {
        const top = element.getBoundingClientRect().top;
        const bottom = top + element.clientHeight;
        let readerOffset = 0;
        const reader =
          userScrolling.current && !restoringAnchor.current
            ? [
                ...element.querySelectorAll<HTMLElement>("[data-codex-row]"),
              ].find((row) => {
                const rect = row.getBoundingClientRect();
                if (rect.bottom <= top || rect.top >= bottom) return false;
                readerOffset = rect.top - top;
                return true;
              })
            : undefined;
        const readerKey = reader?.dataset.codexRow;
        // The virtualizer's earlier listener has consumed the actual offset.
        // Finish this one buffer transition before saving or leaving the reader.
        readerBufferEnabledRef.current = true;
        flushSync(() => setReaderBufferEnabled(true));
        if (
          reader?.isConnected &&
          reader.dataset.codexRow === readerKey &&
          element.contains(reader) &&
          viewport() === element
        ) {
          // First mounts can clamp a library size adjustment at the old range.
          // Preserve the user's already-scrolled point, correcting only its residue.
          element.scrollTop +=
            reader.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            readerOffset;
        }
      }
    };
    const onScroll = () => {
      if (
        pinned.current &&
        !userScrolling.current &&
        !restoringAnchor.current
      ) {
        // Native layout/selection can dispatch scroll while React is committing.
        // Check the resulting range in the existing follow frame, after those
        // writes; real reader input still takes the synchronous path below.
        cancelAnimationFrame(followFrame);
        followFrame = requestAnimationFrame(() => {
          if (
            pinned.current &&
            !userScrolling.current &&
            !restoringAnchor.current &&
            element.clientHeight > 0 &&
            element.scrollHeight - element.scrollTop - element.clientHeight > 4
          )
            jumpToBottom();
        });
        return;
      }
      if (element.clientHeight === 0) return;
      const distance =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      // The first native wheel frame can move only one pixel. Do not mount
      // rows (and issue size-compensation scrollTo) before that gesture moves.
      if (!readingAway.current || distance > 1) enableReaderBuffer();
      if (restoringAnchor.current) return;
      const atBottom =
        !readingAway.current &&
        element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
      pinned.current = atBottom;
      if (atBottom) userScrolling.current = false;
      setAtBottom(atBottom);
      if (atBottom) {
        readerBufferEnabledRef.current = false;
        setReaderBufferEnabled(false);
      }
      remember(false);
      cancelAnimationFrame(rememberFrame);
      rememberFrame = requestAnimationFrame(() => remember(false));
      // Reading upward pages in older turns before the top becomes a dead end.
      // The reading anchor was just saved above, so the restoration effect
      // keeps this viewport still when the older rows prepend.
      const paging = useSessionSyncStore.getState();
      if (
        shouldLoadEarlierOnScroll({
          scrollTop: element.scrollTop,
          pinnedToBottom: pinned.current,
          cursor: paging.cursors[activeThreadId],
          trimmedAnchor: paging.trimmedHistoryAnchors[activeThreadId],
          loading: paging.earlierLoading[activeThreadId],
          error: paging.earlierErrors[activeThreadId],
        })
      ) {
        anchorBeforeEarlierLoad();
        void codexService.loadEarlierHistory(activeThreadId);
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        // A completed one-pixel gesture still receives its reading buffer.
        // Preserve the live reading point before ending the user-scroll phase.
        enableReaderBuffer();
        remember();
        userScrolling.current = false;
      }, 150);
    };
    const markUserScroll = (away = false) => {
      // A new gesture supersedes the previous quiet completion. Its first
      // native scroll must arrive before that completion can mount more rows.
      clearTimeout(saveTimer);
      readingAway.current = away;
      userScrolling.current = true;
      restoringAnchor.current = false;
    };
    const detachFromBottom = () => {
      if (!pinned.current) return;
      pinned.current = false;
      setAtBottom(false);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const readyReader =
        !pinned.current &&
        !restoringAnchor.current &&
        reading.current?.atBottom === false &&
        reading.current.scrollTop === element.scrollTop &&
        virtualizer.scrollOffset === element.scrollTop;
      markUserScroll(event.deltaY < 0);
      // A previous native scroll has already established this reading point.
      // Finish its buffer before the next wheel's default movement begins.
      // First detachment still waits for the native offset in onScroll.
      if (readyReader) enableReaderBuffer();
      // Release before the browser's scroll event so live updates cannot steal
      // even a small upward trackpad movement in the same frame.
      if (event.deltaY < 0) detachFromBottom();
      else if (
        element.scrollHeight - element.scrollTop - element.clientHeight <=
        1
      )
        jumpToBottom();
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
      touchLastY = touch?.clientY ?? 0;
      touchScrolling = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !touchStart) return;
      const dy = Math.abs(touch.clientY - touchStart.y);
      if (dy > 8 && dy > Math.abs(touch.clientX - touchStart.x))
        touchScrolling = true;
      const direction = touch.clientY - touchLastY;
      touchLastY = touch.clientY;
      if (touchScrolling && direction !== 0) {
        markUserScroll(direction > 0);
        if (direction > 0) detachFromBottom();
        else if (
          element.scrollHeight - element.scrollTop - element.clientHeight <=
          1
        )
          jumpToBottom();
      }
    };
    const onTouchEnd = () => {
      touchStart = null;
      touchScrolling = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (isTranscriptScrollKey(event)) {
        const away =
          ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
          (event.key === " " && event.shiftKey);
        markUserScroll(away);
        if (away) detachFromBottom();
        else if (
          element.scrollHeight - element.scrollTop - element.clientHeight <=
          1
        )
          jumpToBottom();
      }
    };
    const onPointer = (event: PointerEvent) => {
      // Only a mouse scrollbar drag counts; clicking text/buttons and touch taps do not.
      const scrollbar =
        event.target instanceof Element
          ? event.target.closest('[data-slot="scroll-area-scrollbar"]')
          : null;
      if (
        event.pointerType === "mouse" &&
        ((scrollbar && rootRef.current?.contains(scrollbar)) ||
          (event.target === element &&
            event.clientX >=
              element.getBoundingClientRect().left + element.clientWidth))
      ) {
        markUserScroll();
        detachFromBottom();
      }
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchEnd, { passive: true });
    element.addEventListener("keydown", onKey);
    rootRef.current?.addEventListener("pointerdown", onPointer);
    const root = rootRef.current;
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
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
        openedWork: openedWorkRef.current,
      });
      if (positions.size > 50) positions.delete(positions.keys().next().value!);
    };
  }, [activeThreadId, viewport, virtualizer, jumpToBottom]);
  const pendingPinnedResize = useRef(false);
  useLayoutEffect(() => {
    if (!pendingPinnedResize.current) return;
    pendingPinnedResize.current = false;
    // The virtualizer's following commit also moves the trailing padding and
    // latest marker. Complete only that resize's follow before its paint.
    if (pinned.current) jumpToBottom();
  });
  const lastRowKey = rows.at(-1)?.key;
  const lastMountedKey = virtualizer.getVirtualItems().at(-1)?.key;
  useLayoutEffect(() => {
    let frame = 0;
    const element = viewport();
    const content = contentRef.current;
    const lastRow = element?.querySelector<HTMLElement>(
      `[data-index="${rows.length - 1}"]`,
    );
    const observer = new ResizeObserver((entries) => {
      if (!pinned.current) return;
      cancelAnimationFrame(frame);
      // Absolute row content can grow before its measured totalSize wrapper.
      // Follow its delivered height before paint; viewport changes keep the
      // existing RAF boundary and readers who detached are never moved.
      if (
        lastRow?.isConnected &&
        entries.some(
          (entry) => entry.target === lastRow || entry.target === content,
        )
      ) {
        pendingPinnedResize.current = true;
        jumpToBottom();
        return;
      }
      frame = requestAnimationFrame(() => {
        if (pinned.current) jumpToBottom();
      });
    });
    if (element) observer.observe(element);
    if (content) observer.observe(content);
    if (lastRow) observer.observe(lastRow);
    return () => {
      pendingPinnedResize.current = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [jumpToBottom, viewport, rows.length, lastRowKey, lastMountedKey]);

  return (
    <div
      className={`codex-presentation relative flex-1 flex flex-col min-h-0 ${fillHeight ? "h-full" : ""}`}
    >
      <ThreadWorkflowToolbar
        threadId={activeThreadId}
        rows={workflow.messages}
        turns={workflow.turns}
        title={title ?? undefined}
        running={runtime.running}
        inspection={inspection}
        historyComplete={!earlierAvailable}
        onLoadEarlier={() => codexService.loadEarlierHistory(activeThreadId)}
        onNavigate={navigateToMessage}
        onPrepareMatch={prepareSearchMatch}
      />
      <ThreadUserNavigationRail
        rows={workflow.messages}
        onNavigate={navigateToMessage}
        activeTurnIds={visibleTurns}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea ref={rootRef} className="h-full px-4 pb-4">
          <div
            ref={contentRef}
            className="codex-transcript-surface thread-surface mx-auto py-4"
          >
            {earlierAvailable && (
              <div className="session-earlier-history">
                <button
                  type="button"
                  disabled={earlierLoading}
                  onClick={() => {
                    anchorBeforeEarlierLoad();
                    void codexService.loadEarlierHistory(activeThreadId);
                  }}
                >
                  {earlierLoading
                    ? "正在加载更早消息…"
                    : earlierError
                      ? "重试加载更早消息"
                      : "加载更早消息"}
                </button>
                {earlierError && (
                  <span role="status" title={earlierError}>
                    加载失败：{earlierError}
                  </span>
                )}
              </div>
            )}
            <GoalTranscriptAnnouncements
              announcements={goalSlots.before}
              placement="before"
            />
            {completionSlot?.afterRow === null && completionTarget && (
              <GoalCompletionFallback
                threadId={activeThreadId}
                turnId={completionTarget.turnId}
              />
            )}
            <div
              ref={rowListRef}
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
                      transform: `translateY(${item.start - rowScrollMargin}px)`,
                      paddingBottom: 16,
                    }}
                  >
                    <RowStateContext.Provider value={state}>
                      <ThreadMessage
                        row={rows[item.index]}
                        onToggleWork={toggleWork}
                        retryNotice={
                          rows[item.index].work?.turnId === turnTiming?.turnId
                            ? retryNotice
                            : undefined
                        }
                        nativeEditUser={
                          rows[item.index].key === workflow.lastUserRowId
                        }
                        alwaysShowAssistantActions={
                          rows[item.index].key === persistentAssistantRowId
                        }
                        hookRuns={rowHooks(rows[item.index])}
                      />
                      <GoalTranscriptAnnouncements
                        announcements={goalSlots.afterRow.get(
                          rows[item.index].key,
                        )}
                      />
                      {completionSlot?.afterRow === rows[item.index].key &&
                        completionTarget && (
                          <GoalCompletionFallback
                            threadId={activeThreadId}
                            turnId={completionTarget.turnId}
                          />
                        )}
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
                  turnId={streamingMessage.turnId}
                  streaming
                  streamingSegments={
                    streamingMessage.preview
                      ? undefined
                      : streamingMessage.segments
                  }
                  streamingCurrent={streamingMessage.current}
                  streamingPreview={streamingMessage.preview}
                />
                {turnTiming?.turnId === streamingMessage.turnId && (
                  <MessageTimestamp
                    fallback={{ ms: turnTiming.startedAtMs, label: "轮次开始" }}
                  />
                )}
              </div>
            )}
            <div className="space-y-2">
              <CodexDeliveryEchoes threadId={activeThreadId} events={events} />
              <CodexHistoryNotice
                loading={loading}
                loaded={loaded && !needsCodexTranscriptRestore(activeThreadId)}
                error={historyError}
                onRetry={() => {
                  if (inspection) {
                    void codexService
                      .loadThreadHistory(activeThreadId, undefined, {
                        background: true,
                        recent: true,
                      })
                      .catch(() => {});
                  } else requestSessionHistorySync(activeThreadId);
                }}
              />
              <ApprovalItem currentThreadId={activeThreadId} />
              {!rows.some((row) => row.work?.turnId === turnTiming?.turnId) && (
                <WorkingIndicator
                  turnTiming={turnTiming}
                  retryNotice={retryNotice}
                />
              )}
              <RequestUserInputItem currentThreadId={activeThreadId} />
              <ElicitationItem currentThreadId={activeThreadId} />
              <PermissionsItem currentThreadId={activeThreadId} />
              <div className="flex items-start justify-end gap-2 py-1">
                <CodexProtocolRecords
                  events={events}
                  threadId={activeThreadId}
                />
                <ThreadSources
                  key={`sources:${activeThreadId}`}
                  threadId={activeThreadId}
                  events={events}
                />
              </div>
              <div ref={latestRef} data-session-latest style={{ height: 1 }} />
            </div>
          </div>
        </ScrollArea>
      </div>
      <CodexSystemRecords
        key={`records:${activeThreadId}`}
        threadId={activeThreadId}
        count={closedRecordCount}
      />
      <CodexAccessNotice
        key={`access:${activeThreadId}`}
        threadId={activeThreadId}
        suppressStatus={Boolean(historyError)}
      />
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

export default function LoadedCodexTranscript(props: {
  activeThreadId: string;
  fillHeight: boolean;
  inspection: boolean;
}) {
  return (
    <GoalCompletionScope
      key={props.activeThreadId}
      threadId={props.activeThreadId}
    >
      <CodexTranscript {...props} />
    </GoalCompletionScope>
  );
}
