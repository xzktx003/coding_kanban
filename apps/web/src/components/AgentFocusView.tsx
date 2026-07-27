import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { FocusSidebarSessionCard } from "./FocusSidebarSessionCard";
import { LazyTerminalView } from "./LazyTerminalView";
import { SessionGroupHeader } from "./SessionGroupControls";
import { TerminalPreview } from "./TerminalPreview";
import {
  groupSessions,
  isSessionGroupCollapsed,
  type SessionGroupState,
} from "../lib/session-groups";
import {
  focusActiveTerminalTextarea,
  getActiveTerminalTextarea,
  shouldActivateTerminalPaneFromPointer,
} from "../lib/terminal-focus";
import {
  TERMINAL_MONITOR_LAYOUT_OPTIONS,
  areTerminalMonitorSlotsEqual,
  closeTerminalMonitorSlot,
  closeTerminalMonitorSlotWithReplacement,
  findFirstTerminalMonitorReplacementSession,
  findNextOccupiedTerminalMonitorSlot,
  getTerminalMonitorSlotIds,
  getTerminalPaneContextPrimaryActionLabel,
  isTerminalMonitorLayoutMode,
  normalizeTerminalMonitorSlots,
  placeTerminalMonitorSlotSession,
  restoreTerminalMonitorLayoutSnapshot,
  setTerminalMonitorSlotSession,
  type RestorableTerminalMonitorLayoutMode,
  type TerminalMonitorLayoutSnapshot,
  type TerminalMonitorLayoutMode,
  type TerminalMonitorSlot,
} from "../lib/terminal-layout";

interface AgentFocusViewProps {
  focusedSession: AgentSessionRecord;
  sessions: AgentSessionRecord[];
  syncActiveTerminalWithFocus?: boolean;
  onActiveTerminalSessionChange?: (id: string | null) => void;
  onSwitchFocus: (id: string) => void;
  onExit: () => void;
  onReconnect: (id: string) => void;
  onDeleteSession: (id: string) => Promise<void> | void;
  onHideSession: (id: string) => Promise<void> | void;
  onRename?: (id: string) => void;
  mobileTerminalTouchMode?: boolean;
  useLightweightTerminalPreview?: boolean;
  terminalFontSize?: number;
  onTerminalFontSizeChange?: (fontSize: number) => void;
  sessionGroups?: SessionGroupState;
  onCreateSessionGroup?: (sessionId?: string) => void;
  onDeleteSessionGroup?: (groupId: string) => void;
  onMoveSessionToGroup?: (sessionId: string, groupId: string | null) => void;
  onRenameSessionGroup?: (groupId: string) => void;
  onToggleSessionGroup?: (groupId: string) => void;
}

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  detached: "已分离",
  exited: "已退出",
};

const TERMINAL_MONITOR_LAYOUT_STORAGE_KEY = "terminal-monitor-layout-mode";
const DEFAULT_TERMINAL_MONITOR_SLOT_ID = "terminal-monitor-slot-1";
const FOCUS_HEADER_COLLAPSED_STORAGE_KEY = "focus-header-collapsed";
const TERMINAL_MONITOR_DRAG_MIME =
  "application/x-coding-kanban-terminal-session";
const FOCUS_SIDEBAR_SCROLL_THRESHOLD = 4;

interface TerminalMonitorDragPayload {
  sessionId: string;
  sourceSlotId?: string;
}

interface TerminalPaneContextMenuState {
  source: "pane" | "sidebar";
  slotId: string;
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
}

function shouldUseTerminalMonitorDragImage(): boolean {
  const testFlags = window as Window & {
    __disableTerminalMonitorDragImageForTest?: boolean;
    __forceTerminalMonitorDragImageForTest?: boolean;
  };
  if (testFlags.__forceTerminalMonitorDragImageForTest) {
    return true;
  }
  if (testFlags.__disableTerminalMonitorDragImageForTest) {
    return false;
  }

  return !navigator.webdriver;
}

function loadTerminalMonitorLayoutMode(): TerminalMonitorLayoutMode {
  try {
    const raw = localStorage.getItem(TERMINAL_MONITOR_LAYOUT_STORAGE_KEY);
    return isTerminalMonitorLayoutMode(raw) ? raw : "single";
  } catch {
    return "single";
  }
}

function saveTerminalMonitorLayoutMode(mode: TerminalMonitorLayoutMode): void {
  try {
    localStorage.setItem(TERMINAL_MONITOR_LAYOUT_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

function loadFocusHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(FOCUS_HEADER_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveFocusHeaderHeaderCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(FOCUS_HEADER_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // ignore storage failures
  }
}

function readTerminalMonitorDragPayload(
  dataTransfer: DataTransfer,
): TerminalMonitorDragPayload | null {
  const raw =
    dataTransfer.getData(TERMINAL_MONITOR_DRAG_MIME) ||
    dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TerminalMonitorDragPayload>;
    return typeof parsed.sessionId === "string"
      ? {
          sessionId: parsed.sessionId,
          sourceSlotId:
            typeof parsed.sourceSlotId === "string"
              ? parsed.sourceSlotId
              : undefined,
        }
      : null;
  } catch {
    return { sessionId: raw };
  }
}

export function AgentFocusView({
  focusedSession,
  sessions,
  syncActiveTerminalWithFocus = false,
  onActiveTerminalSessionChange,
  onSwitchFocus,
  onExit,
  onReconnect,
  onDeleteSession,
  onHideSession,
  onRename,
  mobileTerminalTouchMode = false,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
  sessionGroups = { groups: [], assignments: {}, collapsedGroupIds: [] },
  onCreateSessionGroup,
  onDeleteSessionGroup,
  onMoveSessionToGroup,
  onRenameSessionGroup,
  onToggleSessionGroup,
}: AgentFocusViewProps) {
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session.hidden),
    [sessions],
  );
  const displayableSessions = useMemo(() => {
    if (!focusedSession.hidden) {
      return visibleSessions;
    }

    return [
      focusedSession,
      ...visibleSessions.filter((session) => session.id !== focusedSession.id),
    ];
  }, [focusedSession, visibleSessions]);
  const [terminalLayoutMode, setTerminalLayoutMode] =
    useState<TerminalMonitorLayoutMode>(loadTerminalMonitorLayoutMode);
  const [activeSlotId, setActiveSlotId] = useState(
    DEFAULT_TERMINAL_MONITOR_SLOT_ID,
  );
  const [terminalSlots, setTerminalSlots] = useState<TerminalMonitorSlot[]>(
    () =>
      normalizeTerminalMonitorSlots({
        mode: terminalLayoutMode,
        sessions: displayableSessions,
        preferredSessionId: focusedSession.id,
        preferredSlotId: DEFAULT_TERMINAL_MONITOR_SLOT_ID,
      }),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [headerCollapsed, setHeaderCollapsed] = useState(
    loadFocusHeaderCollapsed,
  );
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [closedSlotIds, setClosedSlotIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [paneContextMenu, setPaneContextMenu] =
    useState<TerminalPaneContextMenuState | null>(null);
  const [restorableTerminalMonitorLayout, setRestorableTerminalMonitorLayout] =
    useState<TerminalMonitorLayoutSnapshot | null>(null);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const paneContextMenuRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewElementRef = useRef<HTMLElement | null>(null);
  const sessionById = useMemo(() => {
    return new Map(sessions.map((session) => [session.id, session]));
  }, [sessions]);
  const renderedSessionIds = new Set(
    terminalSlots
      .map((slot) => slot.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const usedSessionIds = renderedSessionIds;
  const sidebarSessions = visibleSessions;
  const otherSessions = visibleSessions.filter(
    (session) => !renderedSessionIds.has(session.id),
  );
  const sessionMonitorPlacementById = useMemo(
    () =>
      new Map(
        terminalSlots.flatMap((slot, index) =>
          slot.sessionId
            ? [
                [
                  slot.sessionId,
                  { slotId: slot.id, monitorIndex: index + 1 },
                ] as const,
              ]
            : [],
        ),
      ),
    [terminalSlots],
  );
  const filteredSidebarSessions = sidebarSearchQuery
    ? sidebarSessions.filter(
        (s) =>
          s.displayName
            .toLowerCase()
            .includes(sidebarSearchQuery.toLowerCase()) ||
          s.agentKind
            .toLowerCase()
            .includes(sidebarSearchQuery.toLowerCase()) ||
          (s.workingDirectory ?? "")
            .toLowerCase()
            .includes(sidebarSearchQuery.toLowerCase()),
      )
    : sidebarSessions;
  const groupingEnabled = sessionGroups.groups.length > 0;
  const groupedSidebarSessions = useMemo(
    () => groupSessions(filteredSidebarSessions, sessionGroups),
    [filteredSidebarSessions, sessionGroups],
  );
  const sidebarRenderedUnitCount = groupingEnabled
    ? groupedSidebarSessions.reduce(
        (total, group) =>
          total +
          1 +
          (isSessionGroupCollapsed(sessionGroups, group.id)
            ? 0
            : group.sessions.length),
        0,
      )
    : filteredSidebarSessions.length;
  const sidebarScrollMode =
    sidebarRenderedUnitCount > FOCUS_SIDEBAR_SCROLL_THRESHOLD;
  const activeSlotAvailable = terminalSlots.some(
    (slot) => slot.id === activeSlotId,
  );
  const safeActiveSlotId = activeSlotAvailable
    ? activeSlotId
    : (terminalSlots[0]?.id ?? DEFAULT_TERMINAL_MONITOR_SLOT_ID);
  // Derive the title/rename target from the active slot's session directly,
  // so the header always reflects the pane the user is currently typing into,
  // regardless of whether App-level focusedId is synchronized.
  const activeSlotSessionId =
    terminalSlots.find((slot) => slot.id === safeActiveSlotId)?.sessionId ??
    null;
  const activeHeaderSession =
    (activeSlotSessionId ? sessionById.get(activeSlotSessionId) : undefined) ??
    focusedSession;
  const activeLayoutOption =
    TERMINAL_MONITOR_LAYOUT_OPTIONS.find(
      (option) => option.mode === terminalLayoutMode,
    ) ?? TERMINAL_MONITOR_LAYOUT_OPTIONS[0]!;
  const canRestoreMultiPaneLayout =
    terminalLayoutMode === "single" && restorableTerminalMonitorLayout !== null;
  const primaryContextMenuActionLabel =
    getTerminalPaneContextPrimaryActionLabel(canRestoreMultiPaneLayout);

  useEffect(() => {
    saveTerminalMonitorLayoutMode(terminalLayoutMode);
  }, [terminalLayoutMode]);

  useEffect(() => {
    saveFocusHeaderHeaderCollapsed(headerCollapsed);
  }, [headerCollapsed]);

  useEffect(() => {
    onActiveTerminalSessionChange?.(activeSlotSessionId);
  }, [activeSlotSessionId, onActiveTerminalSessionChange]);

  useEffect(() => {
    return () => {
      removeTerminalMonitorDragPreview();
    };
  }, []);

  useEffect(() => {
    if (!layoutMenuOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        layoutMenuRef.current &&
        !layoutMenuRef.current.contains(target)
      ) {
        setLayoutMenuOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLayoutMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [layoutMenuOpen]);

  useEffect(() => {
    if (!paneContextMenu) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        paneContextMenuRef.current &&
        paneContextMenuRef.current.contains(target)
      ) {
        return;
      }

      setPaneContextMenu(null);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPaneContextMenu(null);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [paneContextMenu]);

  useEffect(() => {
    const availableSlotIds = getTerminalMonitorSlotIds(terminalLayoutMode);
    const nextActiveSlotId = availableSlotIds.includes(activeSlotId)
      ? activeSlotId
      : availableSlotIds[0]!;

    if (nextActiveSlotId !== activeSlotId) {
      setActiveSlotId(nextActiveSlotId);
    }

    setTerminalSlots((current) => {
      const normalized = normalizeTerminalMonitorSlots({
        mode: terminalLayoutMode,
        sessions: displayableSessions,
        preferredSessionId: focusedSession.id,
        preferredSlotId: nextActiveSlotId,
        previousSlots: current,
      });
      const next = normalized.map((slot) =>
        closedSlotIds.has(slot.id) ? { ...slot, sessionId: null } : slot,
      );

      return areTerminalMonitorSlotsEqual(current, next) ? current : next;
    });
  }, [
    activeSlotId,
    closedSlotIds,
    displayableSessions,
    focusedSession.id,
    terminalLayoutMode,
  ]);

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="dialog"], [role="alertdialog"]',
      )
    ) {
      return;
    }

    focusActiveTerminalTextarea();
  }, [focusedSession.id, safeActiveSlotId, terminalLayoutMode, terminalSlots]);

  function activateSlot(slot: TerminalMonitorSlot) {
    if (!slot.sessionId) {
      return;
    }

    setActiveSlotId(slot.id);
    if (syncActiveTerminalWithFocus && slot.sessionId !== focusedSession.id) {
      onSwitchFocus(slot.sessionId);
    }
  }

  function handlePanePointerDownCapture(
    slot: TerminalMonitorSlot,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (
      !shouldActivateTerminalPaneFromPointer({
        button: event.button,
        pointerType: event.pointerType,
      })
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, textarea, select, a, [contenteditable="true"], [contenteditable=""]',
      )
    ) {
      return;
    }

    activateSlot(slot);
  }

  function handleSelectSlotSession(slotId: string, sessionId: string) {
    if (!sessionId) {
      return;
    }

    setRestorableTerminalMonitorLayout(null);
    setTerminalSlots((current) =>
      setTerminalMonitorSlotSession(current, slotId, sessionId),
    );
    setClosedSlotIds((current) => {
      const next = new Set(current);
      next.delete(slotId);
      return next;
    });
    setActiveSlotId(slotId);
    if (
      (syncActiveTerminalWithFocus || slotId === safeActiveSlotId) &&
      sessionId !== focusedSession.id
    ) {
      onSwitchFocus(sessionId);
    }
  }

  function placeSessionInSlot(
    slotId: string,
    sessionId: string,
    sourceSlotId?: string,
  ) {
    if (!sessionById.has(sessionId)) {
      return;
    }

    setRestorableTerminalMonitorLayout(null);
    setTerminalSlots((current) =>
      placeTerminalMonitorSlotSession(current, slotId, sessionId, sourceSlotId),
    );
    setClosedSlotIds((current) => {
      const next = new Set(current);
      next.delete(slotId);
      if (sourceSlotId) {
        next.delete(sourceSlotId);
      }
      return next;
    });
    setActiveSlotId(slotId);
    if (
      (syncActiveTerminalWithFocus ||
        slotId === safeActiveSlotId ||
        sourceSlotId === safeActiveSlotId) &&
      sessionId !== focusedSession.id
    ) {
      onSwitchFocus(sessionId);
    }
  }

  function removeTerminalMonitorDragPreview() {
    dragPreviewElementRef.current?.remove();
    dragPreviewElementRef.current = null;
  }

  function createTerminalMonitorDragPreviewCanvas(session: AgentSessionRecord) {
    removeTerminalMonitorDragPreview();

    const width = 264;
    const height = 88;
    const scale = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.dataset.sessionId = session.id;
    canvas.dataset.previewKind = "terminal-monitor-session";
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.zIndex = "-1";
    canvas.style.pointerEvents = "none";

    const context = canvas.getContext("2d");
    if (!context) {
      return canvas;
    }

    context.scale(scale, scale);
    context.fillStyle = "rgba(12, 16, 21, 0.96)";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(95, 198, 255, 0.5)";
    context.strokeRect(0.5, 0.5, width - 1, height - 1);
    context.fillStyle = "rgba(244, 241, 234, 0.92)";
    context.font = '700 12px "SFMono-Regular", Consolas, monospace';
    context.fillText(session.displayName, 10, 20, 170);
    context.fillStyle = "rgba(255, 152, 0, 0.26)";
    context.fillRect(width - 62, 9, 52, 18);
    context.fillStyle = "rgba(255, 224, 173, 0.95)";
    context.font = '700 11px "SFMono-Regular", Consolas, monospace';
    context.fillText(
      stateLabels[session.interactionState] ?? session.interactionState,
      width - 56,
      22,
      42,
    );
    context.fillStyle = "#0e1217";
    context.fillRect(9, 34, width - 18, 45);
    context.fillStyle = "rgba(202, 232, 255, 0.82)";
    context.font = '10px "SFMono-Regular", Consolas, monospace';
    const lines = (session.outputPreview || "ready").split(/\r?\n/).slice(-3);
    lines.forEach((line, index) => {
      context.fillText(line, 16, 49 + index * 13, width - 32);
    });

    document.body.appendChild(canvas);
    dragPreviewElementRef.current = canvas;
    return canvas;
  }

  function startSessionDrag(
    sessionId: string,
    event: React.DragEvent<HTMLElement>,
    sourceSlotId?: string,
  ) {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, textarea, select, a, [contenteditable="true"], [contenteditable=""]',
      )
    ) {
      event.preventDefault();
      return;
    }

    const payload: TerminalMonitorDragPayload = {
      sessionId,
      sourceSlotId,
    };
    const serialized = JSON.stringify(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TERMINAL_MONITOR_DRAG_MIME, serialized);
    event.dataTransfer.setData("text/plain", serialized);

    const session = sessionById.get(sessionId);
    if (session && shouldUseTerminalMonitorDragImage()) {
      const preview = createTerminalMonitorDragPreviewCanvas(session);
      event.dataTransfer.setDragImage(preview, 132, 44);
    }
  }

  function finishSessionDrag() {
    setDragOverSlotId(null);
    // Defer removal so the browser has time to snapshot the drag image
    // before we tear it down. A single frame is enough — the browser
    // captures synchronously or on the next compositing pass.
    requestAnimationFrame(() => {
      removeTerminalMonitorDragPreview();
    });
  }

  function handleSlotDragOver(
    slotId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) {
    let hasTerminalSession = false;
    const types = event.dataTransfer.types;
    for (let idx = 0; idx < types.length; idx++) {
      if (types[idx] === TERMINAL_MONITOR_DRAG_MIME) {
        hasTerminalSession = true;
        break;
      }
    }
    if (!hasTerminalSession) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverSlotId(slotId);
  }

  function handleSlotDrop(
    slotId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) {
    const payload = readTerminalMonitorDragPayload(event.dataTransfer);
    if (!payload) {
      return;
    }

    event.preventDefault();
    finishSessionDrag();
    placeSessionInSlot(slotId, payload.sessionId, payload.sourceSlotId);
  }

  function handlePaneTitleContextMenu(
    slot: TerminalMonitorSlot,
    session: AgentSessionRecord | null,
    isActiveInputPane: boolean,
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (!session || !isActiveInputPane) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPaneContextMenu({
      source: "pane",
      slotId: slot.id,
      sessionId: session.id,
      displayName: session.displayName,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleSidebarContextMenu(
    session: AgentSessionRecord,
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setPaneContextMenu({
      source: "sidebar",
      slotId: "",
      sessionId: session.id,
      displayName: session.displayName,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function showContextSessionInSinglePane() {
    if (!paneContextMenu) {
      return;
    }

    if (terminalLayoutMode !== "single") {
      setRestorableTerminalMonitorLayout({
        mode: terminalLayoutMode as RestorableTerminalMonitorLayoutMode,
        slots: terminalSlots.map((slot) => ({ ...slot })),
        activeSlotId: safeActiveSlotId,
        closedSlotIds: Array.from(closedSlotIds),
      });
    }
    setTerminalLayoutMode("single");
    setClosedSlotIds(new Set());
    setTerminalSlots([
      {
        id: DEFAULT_TERMINAL_MONITOR_SLOT_ID,
        sessionId: paneContextMenu.sessionId,
      },
    ]);
    setActiveSlotId(DEFAULT_TERMINAL_MONITOR_SLOT_ID);
    if (paneContextMenu.sessionId !== focusedSession.id) {
      onSwitchFocus(paneContextMenu.sessionId);
    }
    setPaneContextMenu(null);
  }

  function restoreContextMultiPaneLayout() {
    if (!paneContextMenu || !restorableTerminalMonitorLayout) {
      return;
    }

    const restored = restoreTerminalMonitorLayoutSnapshot({
      snapshot: restorableTerminalMonitorLayout,
      sessions: displayableSessions,
      preferredSessionId: paneContextMenu.sessionId,
    });
    const activeSessionId =
      restored.slots.find((slot) => slot.id === restored.activeSlotId)
        ?.sessionId ?? null;

    setTerminalLayoutMode(restored.mode);
    setTerminalSlots(restored.slots);
    setClosedSlotIds(new Set(restored.closedSlotIds));
    setActiveSlotId(restored.activeSlotId);
    setRestorableTerminalMonitorLayout(null);
    if (activeSessionId && activeSessionId !== focusedSession.id) {
      onSwitchFocus(activeSessionId);
    }
    setPaneContextMenu(null);
  }

  function closeContextPaneDisplay(
    contextMenu: TerminalPaneContextMenuState | null = paneContextMenu,
  ) {
    if (!contextMenu || contextMenu.source !== "pane") {
      return;
    }

    setRestorableTerminalMonitorLayout(null);
    const replacementSession = findFirstTerminalMonitorReplacementSession(
      otherSessions,
      contextMenu.sessionId,
    );
    const nextSlots = closeTerminalMonitorSlotWithReplacement(
      terminalSlots,
      contextMenu.slotId,
      replacementSession?.id,
    );
    const activeSlotStillVisible = nextSlots.find(
      (slot) => slot.id === safeActiveSlotId && Boolean(slot.sessionId),
    );
    const nextActiveSlot =
      activeSlotStillVisible ??
      findNextOccupiedTerminalMonitorSlot(nextSlots, contextMenu.slotId);

    setClosedSlotIds((current) => {
      if (!replacementSession) {
        return new Set(current).add(contextMenu.slotId);
      }

      const next = new Set(current);
      next.delete(contextMenu.slotId);
      return next;
    });
    setTerminalSlots(nextSlots);
    if (nextActiveSlot) {
      setActiveSlotId(nextActiveSlot.id);
      if (
        syncActiveTerminalWithFocus &&
        nextActiveSlot.sessionId &&
        nextActiveSlot.sessionId !== focusedSession.id
      ) {
        onSwitchFocus(nextActiveSlot.sessionId);
      }
    } else {
      setActiveSlotId(contextMenu.slotId);
    }
    setPaneContextMenu(null);
  }

  async function hideContextSessionFromKanban() {
    const contextMenu = paneContextMenu;
    if (!contextMenu) {
      return;
    }

    setPaneContextMenu(null);
    if (contextMenu.source === "pane") {
      closeContextPaneDisplay(contextMenu);
      return;
    }

    setRestorableTerminalMonitorLayout(null);
    await onHideSession(contextMenu.sessionId);
  }

  async function deleteContextSession() {
    const contextMenu = paneContextMenu;
    if (!contextMenu) {
      return;
    }

    const { displayName, sessionId, slotId, source } = contextMenu;
    const confirmed = window.confirm(`彻底删除终端「${displayName}」？`);
    setPaneContextMenu(null);
    if (!confirmed) {
      return;
    }

    setRestorableTerminalMonitorLayout(null);
    if (source === "pane") {
      setClosedSlotIds((current) => new Set(current).add(slotId));
      setTerminalSlots((current) => closeTerminalMonitorSlot(current, slotId));
    }
    await onDeleteSession(sessionId);
  }

  function handleSidebarSwitchFocus(sessionId: string) {
    const existingSlot = terminalSlots.find(
      (slot) => slot.sessionId === sessionId,
    );
    if (existingSlot) {
      activateSlot(existingSlot);
      return;
    }

    const slotId = safeActiveSlotId;
    setRestorableTerminalMonitorLayout(null);
    setTerminalSlots((current) =>
      setTerminalMonitorSlotSession(current, slotId, sessionId),
    );
    setClosedSlotIds((current) => {
      const next = new Set(current);
      next.delete(slotId);
      return next;
    });
    setActiveSlotId(slotId);
    if (sessionId !== focusedSession.id) {
      onSwitchFocus(sessionId);
    }
  }

  function handleLayoutModeChange(mode: TerminalMonitorLayoutMode) {
    setTerminalLayoutMode(mode);
    setRestorableTerminalMonitorLayout(null);
    setClosedSlotIds(new Set());
    setLayoutMenuOpen(false);
    const slotIds = getTerminalMonitorSlotIds(mode);
    if (!slotIds.includes(activeSlotId)) {
      setActiveSlotId(slotIds[0] ?? DEFAULT_TERMINAL_MONITOR_SLOT_ID);
    }
  }

  function handleFocusViewPointerDownCapture(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    // Static header/text regions inside focus view are effectively part of the
    // terminal workspace. If the user clicks them, keep the terminal ready for
    // immediate typing instead of leaving focus on the document body and
    // relying on synthetic key forwarding.
    if (target.closest(".focus-terminal-pane-terminal")) {
      return;
    }

    if (
      target.closest(
        'button, input, textarea, select, a, [contenteditable="true"], [contenteditable=""], [role="dialog"], [role="alertdialog"]',
      )
    ) {
      return;
    }

    focusActiveTerminalTextarea();
  }

  useEffect(() => {
    function isInActiveTerminal(node: HTMLElement | null): boolean {
      return Boolean(
        node?.closest(
          '[data-active-terminal-pane="true"] .focus-terminal-pane-terminal',
        ) ||
        (node?.classList.contains("xterm-helper-textarea") &&
          node.closest('[data-active-terminal-pane="true"]')),
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;

      if (e.key === "Escape") {
        // Esc is reserved for dialog-like interactions; never use it to exit focus mode.
        if (!isInActiveTerminal(target) && !isInActiveTerminal(active)) {
          e.stopPropagation();
        }
        return;
      }

      const isExitShortcut =
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey &&
        (e.code === "KeyQ" || e.key.toLowerCase() === "q");

      if (isExitShortcut) {
        e.preventDefault();
        e.stopPropagation();
        onExit();
        return;
      }

      // Buttons and anchors are not text-entry surfaces. If they keep focus,
      // printable keys must be redirected back into the active terminal
      // instead of being dropped on the floor while a TUI like Copilot is
      // waiting for stdin.
      const inInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        active?.isContentEditable ||
        active?.closest('[role="dialog"]') !== null ||
        active?.closest('[role="alertdialog"]') !== null;
      // Guard: skip forwarding when active element is body or null.
      // This is the transient handoff state immediately after the user clicks
      // a static area. focusActiveTerminalTextarea() has already been called
      // via handleFocusViewPointerDownCapture and will bring the textarea to
      // focus asynchronously via requestAnimationFrame + setTimeout. The
      // textarea's native input handler fires the key naturally on focus —
      // forwarding here would send the same key twice.
      if (active === document.body || active === null) {
        return;
      }

      if (
        !inInput &&
        !isInActiveTerminal(target) &&
        !isInActiveTerminal(active)
      ) {
        const textarea = getActiveTerminalTextarea();
        if (textarea) {
          e.preventDefault();
          textarea.focus();
          const forwarded = new KeyboardEvent("keydown", {
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            which: e.which,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            repeat: e.repeat,
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          textarea.dispatchEvent(forwarded);
          e.stopPropagation();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onExit, safeActiveSlotId]);

  return (
    <div
      className={`focus-view${sidebarCollapsed ? " focus-view--sidebar-collapsed" : ""}`}
      onPointerDownCapture={handleFocusViewPointerDownCapture}
    >
      <div className="focus-main">
        <div
          className={`focus-main-header${headerCollapsed ? " focus-main-header--collapsed" : ""}`}
        >
          <button
            className="focus-header-collapse-btn"
            onClick={() => setHeaderCollapsed((c) => !c)}
            title={headerCollapsed ? "展开标题栏" : "折叠标题栏"}
            type="button"
          >
            {headerCollapsed ? "▼" : "▲"}
          </button>
          <span className="focus-main-name">
            {activeHeaderSession.displayName}
          </span>
          {headerCollapsed && (
            <>
              <span
                className={`grid-card-badge badge-${activeHeaderSession.interactionState}`}
                style={{ fontSize: "11px", padding: "2px 6px" }}
              >
                {stateLabels[activeHeaderSession.interactionState] ??
                  activeHeaderSession.interactionState}
              </span>
              <span className="focus-main-kind">
                {activeHeaderSession.agentKind}
              </span>
            </>
          )}
          {!headerCollapsed && (
            <>
              <span
                className={`grid-card-badge badge-${activeHeaderSession.interactionState}`}
              >
                {stateLabels[activeHeaderSession.interactionState] ??
                  activeHeaderSession.interactionState}
              </span>
              <button
                className="focus-rename-btn"
                onClick={() => onRename?.(activeHeaderSession.id)}
                type="button"
              >
                ✎ 改名
              </button>
              <div
                aria-label="终端监控布局"
                className="focus-layout-menu"
                ref={layoutMenuRef}
              >
                <button
                  aria-expanded={layoutMenuOpen}
                  aria-haspopup="menu"
                  className="focus-layout-menu-trigger"
                  onClick={() => setLayoutMenuOpen((current) => !current)}
                  title="选择终端监控屏幕布局"
                  type="button"
                >
                  屏幕布局
                  <span className="focus-layout-menu-current">
                    {activeLayoutOption.label}
                  </span>
                  <span className="focus-layout-menu-count">
                    {activeLayoutOption.capacity}
                  </span>
                  <span
                    aria-hidden="true"
                    className="focus-layout-menu-chevron"
                  >
                    ▾
                  </span>
                </button>
                {layoutMenuOpen && (
                  <div className="focus-layout-menu-options" role="menu">
                    {TERMINAL_MONITOR_LAYOUT_OPTIONS.map((option) => (
                      <button
                        key={option.mode}
                        aria-checked={terminalLayoutMode === option.mode}
                        className={`focus-layout-option${terminalLayoutMode === option.mode ? " focus-layout-option--active" : ""}`}
                        onClick={() => handleLayoutModeChange(option.mode)}
                        role="menuitemradio"
                        title={`${option.label}监控 ${option.capacity} 个终端`}
                        type="button"
                      >
                        <span>{option.label}</span>
                        <strong>{option.capacity}</strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="focus-exit-btn" onClick={onExit} title="Alt+Q">
                返回宫格
              </button>
              {activeHeaderSession.interactionState === "exited" &&
                activeHeaderSession.sourceType !== "remote-tmux-discovered" && (
                  <button
                    className="focus-reconnect-btn"
                    onClick={() => onReconnect(activeHeaderSession.id)}
                  >
                    🔄 重新连接
                  </button>
                )}
            </>
          )}
        </div>
        <div className="focus-main-terminal">
          <div
            className={`focus-terminal-layout focus-terminal-layout--${terminalLayoutMode}`}
          >
            {terminalSlots.map((slot, index) => {
              const session = slot.sessionId
                ? (sessionById.get(slot.sessionId) ?? null)
                : null;
              const isActiveInputPane = Boolean(
                session && slot.id === safeActiveSlotId,
              );

              return (
                <div
                  key={slot.id}
                  className={`focus-terminal-pane${isActiveInputPane ? " focus-terminal-pane--active" : ""}${dragOverSlotId === slot.id ? " focus-terminal-pane--drag-over" : ""}`}
                  data-active-terminal-pane={
                    isActiveInputPane ? "true" : "false"
                  }
                  data-terminal-pane-slot={slot.id}
                  data-terminal-pane-session={session?.id}
                  onDragLeave={(event) => {
                    if (dragOverSlotId !== slot.id) {
                      return;
                    }
                    const pane = event.currentTarget as HTMLElement | null;
                    const related = event.relatedTarget as HTMLElement | null;
                    if (related && pane && pane.contains(related)) {
                      return;
                    }
                    setDragOverSlotId(null);
                  }}
                  onDragOver={(event) => handleSlotDragOver(slot.id, event)}
                  onDrop={(event) => handleSlotDrop(slot.id, event)}
                  onPointerDownCapture={(event) =>
                    handlePanePointerDownCapture(slot, event)
                  }
                >
                  <div
                    className="focus-terminal-pane-header"
                    data-terminal-pane-menu-scope={
                      isActiveInputPane ? "active-titlebar" : undefined
                    }
                    draggable={Boolean(session)}
                    onContextMenuCapture={(event) =>
                      handlePaneTitleContextMenu(
                        slot,
                        session,
                        isActiveInputPane,
                        event,
                      )
                    }
                    onDragStart={(event) => {
                      if (session) {
                        startSessionDrag(session.id, event, slot.id);
                      }
                    }}
                    onDragEnd={finishSessionDrag}
                  >
                    <span className="focus-terminal-pane-index">
                      {index + 1}
                    </span>
                    {isActiveInputPane && (
                      <span
                        aria-label="当前输入终端"
                        className="focus-terminal-active-badge"
                      >
                        当前输入
                      </span>
                    )}
                    <select
                      aria-label={`选择第 ${index + 1} 个监控终端`}
                      className="focus-terminal-session-select"
                      onChange={(event) =>
                        handleSelectSlotSession(slot.id, event.target.value)
                      }
                      value={session?.id ?? ""}
                    >
                      {!session && <option value="">无可用会话</option>}
                      {displayableSessions.map((candidate) => {
                        const usedElsewhere =
                          usedSessionIds.has(candidate.id) &&
                          candidate.id !== session?.id;

                        return (
                          <option
                            key={candidate.id}
                            disabled={usedElsewhere}
                            value={candidate.id}
                          >
                            {candidate.displayName}
                            {usedElsewhere ? "（已显示）" : ""}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      className={`focus-terminal-input-btn${isActiveInputPane ? " focus-terminal-input-btn--active" : ""}`}
                      aria-disabled={isActiveInputPane ? "true" : undefined}
                      disabled={!session}
                      onClick={() => activateSlot(slot)}
                      type="button"
                    >
                      {isActiveInputPane ? "输入中" : "设为输入"}
                    </button>
                  </div>
                  <div className="focus-terminal-pane-terminal">
                    {session ? (
                      <Suspense
                        fallback={<TerminalPreview session={session} />}
                      >
                        <LazyTerminalView
                          key={session.id}
                          agentSessionId={session.id}
                          fontSize={terminalFontSize}
                          interactive={true}
                          inputEnabled={isActiveInputPane}
                          mobileTouchMode={mobileTerminalTouchMode}
                          onFontSizeChange={onTerminalFontSizeChange}
                        />
                      </Suspense>
                    ) : (
                      <div className="focus-terminal-empty">暂无可监控会话</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {sidebarSessions.length > 0 && (
        <>
          <div className="focus-sidebar-toggle">
            <button
              className="focus-sidebar-toggle-btn"
              data-testid="focus-sidebar-collapse-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? "展开右侧其他会话" : "折叠右侧其他会话"}
              type="button"
            >
              {sidebarCollapsed ? "⟨" : "⟩"}
            </button>
          </div>
          {!sidebarCollapsed && (
            <div
              className={`focus-sidebar${sidebarScrollMode ? " focus-sidebar--scrollable" : ""}`}
              data-sidebar-scroll-mode={sidebarScrollMode ? "enabled" : "auto"}
            >
              <div className="focus-sidebar-heading-row">
                <h3 className="focus-sidebar-title">全部会话</h3>
                <button
                  className="session-group-add-button session-group-add-button--compact"
                  onClick={() => onCreateSessionGroup?.()}
                  type="button"
                >
                  ＋ 分组
                </button>
              </div>
              {sidebarSessions.length > 2 && (
                <input
                  className="focus-sidebar-search"
                  data-testid="sidebar-session-search"
                  onChange={(e) => setSidebarSearchQuery(e.target.value)}
                  placeholder="搜索会话..."
                  value={sidebarSearchQuery}
                />
              )}
              <div
                className="focus-sidebar-scroll"
                data-testid="focus-sidebar-scroll"
              >
                {(groupingEnabled
                  ? groupedSidebarSessions
                  : [
                      {
                        id: "__flat__",
                        name: "",
                        sessions: filteredSidebarSessions,
                      },
                    ]
                ).map((group) => {
                  const collapsed =
                    groupingEnabled &&
                    isSessionGroupCollapsed(sessionGroups, group.id);
                  return (
                    <div className="focus-sidebar-group" key={group.id}>
                      {groupingEnabled && (
                        <SessionGroupHeader
                          compact
                          collapsed={collapsed}
                          count={group.sessions.length}
                          groupId={group.id}
                          name={group.name}
                          onDeleteGroup={onDeleteSessionGroup}
                          onRenameGroup={onRenameSessionGroup}
                          onToggleGroup={onToggleSessionGroup}
                        />
                      )}
                      {!collapsed &&
                        group.sessions.map((session) => {
                          const monitorPlacement =
                            sessionMonitorPlacementById.get(session.id);
                          return (
                            <FocusSidebarSessionCard
                              key={session.id}
                              session={session}
                              monitorIndex={monitorPlacement?.monitorIndex}
                              isActiveMonitor={
                                monitorPlacement?.slotId === safeActiveSlotId
                              }
                              sessionGroups={sessionGroups}
                              onCreateSessionGroup={onCreateSessionGroup}
                              onMoveSessionToGroup={onMoveSessionToGroup}
                              onDragStart={startSessionDrag}
                              onDragEnd={finishSessionDrag}
                              onContextMenu={handleSidebarContextMenu}
                              onRename={onRename}
                              onSwitchFocus={handleSidebarSwitchFocus}
                              useLightweightTerminalPreview={
                                useLightweightTerminalPreview
                              }
                              terminalFontSize={terminalFontSize}
                              onTerminalFontSizeChange={
                                onTerminalFontSizeChange
                              }
                            />
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {paneContextMenu && (
        <div
          className="focus-terminal-pane-context-menu"
          data-testid="terminal-pane-context-menu"
          ref={paneContextMenuRef}
          role="menu"
          style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {paneContextMenu.source === "pane" && (
            <button
              onClick={
                canRestoreMultiPaneLayout
                  ? restoreContextMultiPaneLayout
                  : showContextSessionInSinglePane
              }
              role="menuitem"
              type="button"
            >
              {primaryContextMenuActionLabel}
            </button>
          )}
          <button
            onClick={() => void hideContextSessionFromKanban()}
            role="menuitem"
            type="button"
          >
            关闭看板展示该窗口
          </button>
          <button
            className="focus-terminal-pane-context-menu-danger"
            onClick={() => void deleteContextSession()}
            role="menuitem"
            type="button"
          >
            彻底删除该终端
          </button>
        </div>
      )}
    </div>
  );
}
