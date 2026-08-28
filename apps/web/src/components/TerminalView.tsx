import { memo, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { createCoalescedTrailingScheduler } from "../lib/frame-schedulers";
import "@xterm/xterm/css/xterm.css";

import { buildTerminalWebSocketUrl } from "../lib/api";
import {
  computeMobilePinchFontSize,
  computeMobileTerminalScrollLines,
  getMobileTerminalCursorOptions,
  initializeMobileTerminalCursor,
  loadMobileTerminalFontSize,
  measureTouchDistance,
  saveMobileTerminalFontSize,
} from "../lib/mobile-terminal-touch";
import {
  recordTerminalFrame,
  registerTerminalWebSocket,
} from "../lib/resource-diagnostics";
import { decodeOsc52ClipboardPayload } from "../lib/osc52-clipboard";
import {
  hasIntentionalExternalFocus,
  shouldPromoteExternalFocusToUserIntent,
  shouldRepairPassiveTerminalFocus,
} from "../lib/terminal-focus";
import { TERMINAL_SCROLLBACK_LINES } from "../lib/terminal-history-config";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
} from "../lib/terminal-font-size";
import {
  computeTerminalReconnectDelay,
  getTerminalInputModeRestoreSequence,
  shouldAttemptTerminalInputForward,
} from "../lib/terminal-input-forwarding";
import { isTerminalViewportMeasurable } from "../lib/terminal-resize";
import {
  isTerminalProtocolResponsePayload,
  stripTerminalResponsePayload,
} from "../lib/terminal-input";
import { resolveTerminalMouseGestureAction } from "../lib/terminal-mouse-selection";
import {
  createSafariTextInputRecoveryState,
  isSafariTerminalInputRecoveryRequired,
  recordTerminalTextForSafariRecovery,
  recoverSafariNativeTextInput,
} from "../lib/terminal-safari-input";
import {
  computeTerminalWheelScrollLines,
  isTerminalWheelBlockedByOverlayTarget,
  shouldAllowTerminalWheelToBubble,
  shouldCaptureTerminalWheel,
  shouldForwardTerminalWheelToApplication,
} from "../lib/terminal-wheel";

interface TerminalViewProps {
  agentSessionId: string;
  interactive?: boolean;
  inputEnabled?: boolean;
  mobileTouchMode?: boolean;
  fontSize?: number;
  onFontSizeChange?: (fontSize: number) => void;
  onReady?: () => void;
  suspended?: boolean;
  wheelPassthrough?: boolean;
  preferLocalMouseSelection?: boolean;
  restoreBracketedPasteMode?: boolean;
}

type TerminalContainer = HTMLDivElement & {
  __xterm?: Terminal;
};

interface TerminalInputOwner {
  token: symbol;
  priority: number;
}

interface TerminalControlFrame {
  __agentOrchestrator: "terminal-control";
  event: "replay" | "replay-complete";
  data?: string;
}

interface TerminalGeometry {
  cols: number;
  rows: number;
  width: number;
  height: number;
}

const DEFAULT_PREVIEW_GEOMETRY: TerminalGeometry = {
  cols: 120,
  rows: 30,
  width: 1180,
  height: 760,
};

const EXTERNAL_FOCUS_GRACE_MS = 750;
const PASSIVE_FOCUS_REPAIR_INTERVAL_MS = 500;
const TERMINAL_CONNECT_TIMEOUT_MS = 3_000;
const MOBILE_TERMINAL_REPLAY_BYTES = 256 * 1024;
const MOBILE_TOUCH_LISTENER_OPTIONS = {
  capture: true,
  passive: false,
} satisfies AddEventListenerOptions;

const previewGeometryCache = new Map<string, TerminalGeometry>();
const terminalInputOwners = new Map<string, TerminalInputOwner>();

export const TerminalView = memo(function TerminalView({
  agentSessionId,
  interactive = true,
  inputEnabled: inputEnabledProp,
  mobileTouchMode = false,
  fontSize,
  onFontSizeChange,
  onReady,
  suspended = false,
  wheelPassthrough = false,
  preferLocalMouseSelection = false,
  restoreBracketedPasteMode = false,
}: TerminalViewProps) {
  const inputEnabled = inputEnabledProp ?? interactive;
  const terminalFontSize = clampTerminalFontSize(
    fontSize ??
      (mobileTouchMode
        ? loadMobileTerminalFontSize()
        : DEFAULT_TERMINAL_FONT_SIZE),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalFontSizeRef = useRef(terminalFontSize);
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  const onReadyRef = useRef(onReady);
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const inputEnabledRef = useRef(inputEnabled);
  const terminalInputReadyRef = useRef(false);
  const userScrollLockedRef = useRef(false);

  useEffect(() => {
    terminalFontSizeRef.current = terminalFontSize;
    const term = termRef.current;
    const fitAddon = fitRef.current;
    const container = containerRef.current;
    if (
      !term ||
      !container ||
      term.options.fontSize === terminalFontSize ||
      !isTerminalViewportMeasurable(
        container.clientWidth,
        container.clientHeight,
      )
    ) {
      return;
    }

    term.options.fontSize = terminalFontSize;
    fitAddon?.fit();
    term.refresh(0, Math.max(term.rows - 1, 0));

    const frameId = window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      term.refresh(0, Math.max(term.rows - 1, 0));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [terminalFontSize]);

  useEffect(() => {
    onFontSizeChangeRef.current = onFontSizeChange;
  }, [onFontSizeChange]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
    const term = termRef.current;
    if (!term) {
      return;
    }

    // Keep xterm's protocol response path alive while replay is in progress.
    // The forwarding guard below still blocks ordinary user input until the
    // replay-complete frame arrives.
    term.options.disableStdin = false;
  }, [inputEnabled]);

  useEffect(() => {
    if (suspended) {
      return;
    }

    const container = containerRef.current as TerminalContainer | null;
    const stage = interactive
      ? container
      : (stageRef.current as HTMLDivElement | null);
    if (!container || !stage) return;

    terminalInputReadyRef.current = false;
    userScrollLockedRef.current = false;

    const timeoutIds: number[] = [];
    const intervalIds: number[] = [];
    const animationFrameIds: number[] = [];
    const isPreview = !interactive;
    const ownerToken = Symbol(agentSessionId);
    const ownerPriority = 2;
    let handleMouseDownCapture: ((event: MouseEvent) => void) | null = null;
    let handlePointerDownCapture: ((event: PointerEvent) => void) | null = null;
    let handleTerminalFocusIn: ((event: FocusEvent) => void) | null = null;
    let handleTerminalFocusOut: ((event: FocusEvent) => void) | null = null;
    let handleTerminalBlurCapture: ((event: FocusEvent) => void) | null = null;
    let handleWindowBlur: (() => void) | null = null;
    let handleWindowFocus: (() => void) | null = null;
    let handleMobileTouchStart: ((event: TouchEvent) => void) | null = null;
    let handleMobileTouchMove: ((event: TouchEvent) => void) | null = null;
    let handleMobileTouchEnd: ((event: TouchEvent) => void) | null = null;
    let handleTerminalWheelCapture: ((event: WheelEvent) => void) | null = null;
    let handleDocumentWheelCapture: ((event: WheelEvent) => void) | null = null;
    let handleDocumentPointerDownCapture:
      | ((event: PointerEvent) => void)
      | null = null;
    let handleDocumentFocusInCapture: ((event: FocusEvent) => void) | null =
      null;
    let handleDocumentKeyDownCapture: ((event: KeyboardEvent) => void) | null =
      null;
    let handleSafariNativeInput: ((event: Event) => void) | null = null;
    let clearPreferredMouseGesture: (() => void) | null = null;
    let disposed = false;
    let closeAfterOpen = false;
    let lastExternalPointerIntentAt = 0;
    let lastExternalUserIntentAt = 0;
    let lastTerminalIntentAt = 0;
    let initialReadyReported = false;
    let pendingInitialReplayWrites = 0;
    let replayCompletionObserved = false;
    let wheelScrollRemainder = 0;
    const safariInputRecoveryState = createSafariTextInputRecoveryState();
    const recoverSafariNativeInput =
      typeof navigator !== "undefined" &&
      isSafariTerminalInputRecoveryRequired({
        userAgent: navigator.userAgent,
        vendor: navigator.vendor,
      });

    const ensureInputOwner = () => {
      if (!inputEnabledRef.current) {
        return false;
      }

      const currentOwner = terminalInputOwners.get(agentSessionId);
      if (
        !currentOwner ||
        currentOwner.token === ownerToken ||
        currentOwner.priority <= ownerPriority
      ) {
        terminalInputOwners.set(agentSessionId, {
          token: ownerToken,
          priority: ownerPriority,
        });
        return true;
      }

      return false;
    };

    if (inputEnabledRef.current) {
      ensureInputOwner();
    }

    const cachePreviewGeometry = (cols: number, rows: number) => {
      if (isPreview) {
        return;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }

      previewGeometryCache.set(agentSessionId, {
        cols,
        rows,
        width,
        height,
      });
    };

    const applyPreviewLayout = () => {
      if (!isPreview) {
        return;
      }

      const geometry =
        previewGeometryCache.get(agentSessionId) ?? DEFAULT_PREVIEW_GEOMETRY;
      const scale = Math.min(
        container.clientWidth / geometry.width || 1,
        container.clientHeight / geometry.height || 1,
      );

      stage.style.width = `${geometry.width}px`;
      stage.style.height = `${geometry.height}px`;
      stage.style.left = "50%";
      stage.style.top = "50%";
      stage.style.transformOrigin = "center center";
      stage.style.transform = `translate(-50%, -50%) scale(${Math.max(scale, 0.01)})`;
    };

    const initialFontSize = terminalFontSizeRef.current;
    const term = new Terminal({
      cursorBlink: inputEnabledRef.current,
      ...getMobileTerminalCursorOptions(mobileTouchMode),
      fontSize: initialFontSize,
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
      theme: {
        background: "#0e1217",
        foreground: "#f4f1ea",
        cursor: "#ff8f1f",
        selectionBackground: "rgba(255, 152, 0, 0.3)",
      },
      scrollback: TERMINAL_SCROLLBACK_LINES,
      // xterm uses the same stdin switch for user input and automatic DA/DSR
      // replies. Keep it open and gate user data in the forwarding layer so a
      // TUI that started before this view mounted can finish its handshake.
      disableStdin: false,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    applyPreviewLayout();
    const activeElementBeforeOpen = document.activeElement;
    term.open(stage);
    const inputModeRestoreSequence = getTerminalInputModeRestoreSequence({
      restoreBracketedPaste: restoreBracketedPasteMode,
    });
    if (inputModeRestoreSequence) {
      // Replay drops historical mode toggles. OpenCode still expects paste to
      // arrive as one event so a clipboard newline cannot submit the prompt.
      term.write(inputModeRestoreSequence);
    }
    if (
      initializeMobileTerminalCursor({
        inputEnabled: inputEnabledRef.current,
        mobileTouchMode,
        terminal: term,
      }) &&
      activeElementBeforeOpen instanceof HTMLElement &&
      activeElementBeforeOpen !== document.body &&
      activeElementBeforeOpen.isConnected
    ) {
      activeElementBeforeOpen.focus({ preventScroll: true });
    }
    container.__xterm = term;

    const copyTextToClipboard = (text: string) => {
      if (disposed || !text) {
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          fallbackExecCopy(text);
        });
        return;
      }

      fallbackExecCopy(text);
    };

    let lastCopiedSelection = "";
    const copyTerminalSelectionToClipboard = () => {
      if (disposed || !term.hasSelection()) {
        return;
      }
      const text = term.getSelection();
      if (!text || text === lastCopiedSelection) {
        return;
      }
      lastCopiedSelection = text;
      copyTextToClipboard(text);
    };

    function fallbackExecCopy(text: string) {
      try {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.top = "0";
        helper.style.left = "0";
        helper.style.opacity = "0";
        helper.style.pointerEvents = "none";
        document.body.appendChild(helper);
        const previousActive = document.activeElement as HTMLElement | null;
        helper.focus();
        helper.select();
        document.execCommand("copy");
        document.body.removeChild(helper);
        previousActive?.focus?.();
      } catch {
        /* execCommand path unavailable; nothing more to do */
      }
    }

    const osc52ClipboardDisposable = term.parser.registerOscHandler(
      52,
      (data) => {
        const text = decodeOsc52ClipboardPayload(data);
        if (text) {
          copyTextToClipboard(text);
        }

        return true;
      },
    );

    const handleStageMouseUp = () => {
      copyTerminalSelectionToClipboard();
    };
    stage.addEventListener("mouseup", handleStageMouseUp);

    const handleStageCopyKey = (event: KeyboardEvent) => {
      const isCopyChord =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key === "c" || event.key === "C");
      if (!isCopyChord || !term.hasSelection()) {
        return;
      }
      copyTerminalSelectionToClipboard();
    };
    stage.addEventListener("keydown", handleStageCopyKey);

    let replayingPreferredMouseGesture = false;
    let preferredMouseGesture: {
      target: HTMLElement;
      startX: number;
      startY: number;
      selectionStarted: boolean;
      downEvent: MouseEvent;
    } | null = null;

    const stopPreferredMouseEvent = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const dispatchPreferredMouseEvent = (
      type: "mousedown" | "mousemove" | "mouseup",
      target: HTMLElement,
      source: MouseEvent,
      options: { shiftKey: boolean; buttons: number },
    ) => {
      replayingPreferredMouseGesture = true;
      try {
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            detail: source.detail,
            screenX: source.screenX,
            screenY: source.screenY,
            clientX: source.clientX,
            clientY: source.clientY,
            button: 0,
            buttons: options.buttons,
            ctrlKey: source.ctrlKey,
            altKey: source.altKey,
            metaKey: source.metaKey,
            shiftKey: options.shiftKey,
          }),
        );
      } finally {
        replayingPreferredMouseGesture = false;
      }
    };

    const removePreferredMouseGestureListeners = () => {
      document.removeEventListener("mousemove", handlePreferredMouseMove, true);
      document.removeEventListener("mouseup", handlePreferredMouseUp, true);
    };

    const startPreferredLocalSelection = (event: MouseEvent) => {
      const gesture = preferredMouseGesture;
      if (!gesture || gesture.selectionStarted) {
        return;
      }

      gesture.selectionStarted = true;
      dispatchPreferredMouseEvent(
        "mousedown",
        gesture.target,
        gesture.downEvent,
        { shiftKey: true, buttons: 1 },
      );
      const moveTarget =
        (document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null) ?? gesture.target;
      dispatchPreferredMouseEvent("mousemove", moveTarget, event, {
        shiftKey: true,
        buttons: 1,
      });
    };

    function handlePreferredMouseMove(event: MouseEvent) {
      const gesture = preferredMouseGesture;
      if (!gesture || replayingPreferredMouseGesture) {
        return;
      }

      stopPreferredMouseEvent(event);
      const action = resolveTerminalMouseGestureAction({
        phase: "move",
        startX: gesture.startX,
        startY: gesture.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        selectionStarted: gesture.selectionStarted,
      });
      if (action === "hold") {
        return;
      }
      if (action === "start-selection") {
        startPreferredLocalSelection(event);
        return;
      }

      const moveTarget =
        (document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null) ?? gesture.target;
      dispatchPreferredMouseEvent("mousemove", moveTarget, event, {
        shiftKey: true,
        buttons: 1,
      });
    }

    function handlePreferredMouseUp(event: MouseEvent) {
      const gesture = preferredMouseGesture;
      if (!gesture || replayingPreferredMouseGesture) {
        return;
      }

      stopPreferredMouseEvent(event);
      if (!gesture.selectionStarted) {
        const moveAction = resolveTerminalMouseGestureAction({
          phase: "move",
          startX: gesture.startX,
          startY: gesture.startY,
          currentX: event.clientX,
          currentY: event.clientY,
          selectionStarted: false,
        });
        if (moveAction === "start-selection") {
          startPreferredLocalSelection(event);
        }
      }

      const action = resolveTerminalMouseGestureAction({
        phase: "up",
        startX: gesture.startX,
        startY: gesture.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        selectionStarted: gesture.selectionStarted,
      });
      const upTarget =
        (document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null) ?? gesture.target;

      if (action === "finish-selection") {
        dispatchPreferredMouseEvent("mouseup", upTarget, event, {
          shiftKey: true,
          buttons: 0,
        });
        timeoutIds.push(window.setTimeout(copyTerminalSelectionToClipboard, 0));
      } else {
        dispatchPreferredMouseEvent(
          "mousedown",
          gesture.target,
          gesture.downEvent,
          { shiftKey: false, buttons: 1 },
        );
        dispatchPreferredMouseEvent("mouseup", gesture.target, event, {
          shiftKey: false,
          buttons: 0,
        });
      }

      preferredMouseGesture = null;
      removePreferredMouseGestureListeners();
    }

    const beginPreferredMouseGesture = (event: MouseEvent): boolean => {
      const target = event.target as HTMLElement | null;
      if (
        replayingPreferredMouseGesture ||
        !preferLocalMouseSelection ||
        !inputEnabledRef.current ||
        event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        !target?.closest(".xterm-screen")
      ) {
        return false;
      }

      preferredMouseGesture = {
        target,
        startX: event.clientX,
        startY: event.clientY,
        selectionStarted: false,
        downEvent: event,
      };
      document.addEventListener("mousemove", handlePreferredMouseMove, true);
      document.addEventListener("mouseup", handlePreferredMouseUp, true);
      stopPreferredMouseEvent(event);
      return true;
    };

    clearPreferredMouseGesture = () => {
      preferredMouseGesture = null;
      removePreferredMouseGestureListeners();
    };

    const getHelperTextarea = () =>
      container.querySelector(
        ".xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;

    termRef.current = term;
    fitRef.current = fitAddon;

    const getTerminalLineHeight = () => {
      const fontSize =
        typeof term.options.fontSize === "number"
          ? term.options.fontSize
          : initialFontSize;
      const lineHeight =
        typeof term.options.lineHeight === "number"
          ? term.options.lineHeight
          : 1;

      return Math.max(8, fontSize * lineHeight);
    };

    const refreshUserScrollLock = () => {
      const activeBuffer = term.buffer.active;
      if (activeBuffer.viewportY < activeBuffer.baseY) {
        userScrollLockedRef.current = true;
        return;
      }

      userScrollLockedRef.current = false;
    };

    const reportInitialReadyIfSettled = () => {
      if (
        disposed ||
        initialReadyReported ||
        !replayCompletionObserved ||
        pendingInitialReplayWrites > 0
      ) {
        return;
      }

      initialReadyReported = true;
      onReadyRef.current?.();
    };

    const writeTerminalOutput = (data: string, blocksInitialReady = false) => {
      const preserveViewport =
        userScrollLockedRef.current &&
        term.buffer.active.viewportY < term.buffer.active.baseY;
      const viewportYBeforeWrite = term.buffer.active.viewportY;

      if (blocksInitialReady) {
        pendingInitialReplayWrites += 1;
      }
      term.write(data, () => {
        if (blocksInitialReady) {
          pendingInitialReplayWrites = Math.max(
            0,
            pendingInitialReplayWrites - 1,
          );
        }
        if (!disposed && preserveViewport && userScrollLockedRef.current) {
          term.scrollToLine(
            Math.min(viewportYBeforeWrite, term.buffer.active.baseY),
          );
        }

        reportInitialReadyIfSettled();
      });
    };

    const scrollTerminalWithWheel = (event: WheelEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (inputEnabledRef.current) {
        rememberTerminalIntent();
        focusInteractiveTerminal(true);
      }

      const result = computeTerminalWheelScrollLines({
        deltaMode: event.deltaMode,
        deltaY: event.deltaY,
        lineHeight: getTerminalLineHeight(),
        pageHeight: Math.max(
          getTerminalLineHeight(),
          stage.clientHeight || term.rows * getTerminalLineHeight(),
        ),
        previousDeltaY: wheelScrollRemainder,
      });

      wheelScrollRemainder = result.remainingDeltaY;
      if (result.scrollLines !== 0) {
        term.scrollLines(result.scrollLines);
        refreshUserScrollLock();
      }
    };

    const shouldForwardWheelToApplication = (event: WheelEvent): boolean =>
      shouldForwardTerminalWheelToApplication({
        inputEnabled: inputEnabledRef.current,
        interactive,
        mouseTrackingMode: term.modes.mouseTrackingMode,
        shiftKey: event.shiftKey,
      });

    const eventPointIsInsideContainer = (event: WheelEvent): boolean => {
      const rect = container.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };

    const isProtectedExternalFocusTarget = (
      active: HTMLElement | null,
    ): boolean => {
      if (!active || active === document.body) {
        return false;
      }

      if (active.classList.contains("xterm-helper-textarea")) {
        return false;
      }

      if (active.closest('[inert], [aria-hidden="true"]')) {
        return false;
      }

      return (
        active instanceof HTMLIFrameElement ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLTextAreaElement ||
        Boolean(active.isContentEditable) ||
        active.closest('[role="dialog"]') !== null ||
        active.closest('[role="alertdialog"]') !== null
      );
    };

    const nextIntentTimestamp = (current: number, competing: number) =>
      Math.max(Date.now(), current + 1, competing + 1);

    const rememberExternalUserIntent = (): void => {
      lastExternalUserIntentAt = nextIntentTimestamp(
        lastExternalUserIntentAt,
        lastTerminalIntentAt,
      );
    };

    const rememberExternalPointerIntent = (
      target: EventTarget | null,
    ): void => {
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest(".terminal-view")) {
        return;
      }

      lastExternalPointerIntentAt = Date.now();
      rememberExternalUserIntent();
    };

    const rememberTerminalIntent = (): void => {
      lastTerminalIntentAt = nextIntentTimestamp(
        lastTerminalIntentAt,
        lastExternalUserIntentAt,
      );
    };

    const targetMatchesHover = (target: HTMLElement): boolean => {
      try {
        return target.matches(":hover");
      } catch {
        return false;
      }
    };

    const hasFreshUserActivation = (): boolean => {
      const activation = (
        navigator as Navigator & {
          userActivation?: { isActive?: boolean };
        }
      ).userActivation;

      return activation?.isActive === true;
    };

    const rememberExternalFocusIfUserDriven = (
      target: EventTarget | null,
    ): void => {
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest(".terminal-view")) {
        return;
      }

      if (!isProtectedExternalFocusTarget(target)) {
        return;
      }

      const now = Date.now();
      if (
        !shouldPromoteExternalFocusToUserIntent({
          externalFocusGraceMs: EXTERNAL_FOCUS_GRACE_MS,
          hasFreshUserActivation: hasFreshUserActivation(),
          lastExternalPointerIntentAt,
          lastExternalUserIntentAt,
          lastTerminalIntentAt,
          now,
          targetIsFrame: target instanceof HTMLIFrameElement,
          targetIsHovered: targetMatchesHover(target),
        })
      ) {
        return;
      }

      rememberExternalUserIntent();
    };

    const rememberActiveExternalFocusIfUserDriven = (): void => {
      rememberExternalFocusIfUserDriven(document.activeElement);
    };

    const isIntentionalExternalFocus = (): boolean => {
      const active = document.activeElement as HTMLElement | null;

      // NOTE: HTMLButtonElement is intentionally NOT a protected target.
      // Kanban buttons (sidebar collapse, focus-back-to-grid, action toolbar
      // entries, etc.) are transient triggers; they do not accept text input.
      // Leaving a button focused makes syncTerminalFocusReport emit CSI O and
      // Copilot CLI can drop the next keystrokes. See
      // tests/e2e/copilot-focus.spec.ts.
      return hasIntentionalExternalFocus({
        activeElementIsDocumentBody: !active || active === document.body,
        activeElementProtected: isProtectedExternalFocusTarget(active),
        externalFocusGraceMs: EXTERNAL_FOCUS_GRACE_MS,
        lastExternalUserIntentAt,
        lastTerminalIntentAt,
        now: Date.now(),
      });
    };

    const focusInteractiveTerminal = (unlockInput = false) => {
      if (!interactive || !inputEnabledRef.current) {
        return;
      }

      // When called passively (not from a direct user click on the terminal),
      // don't steal focus from intentional text-entry surfaces, iframes, or
      // open dialogs.
      if (!unlockInput) {
        rememberActiveExternalFocusIfUserDriven();
        if (isIntentionalExternalFocus()) {
          return;
        }
      }

      if (unlockInput) {
        term.options.disableStdin = false;
        rememberTerminalIntent();
      }
      ensureInputOwner();
      term.focus();
    };

    const scheduleFocusInteractiveTerminal = (unlockInput = false) => {
      if (!interactive || !inputEnabledRef.current) {
        return;
      }

      focusInteractiveTerminal(unlockInput);

      const frameId = window.requestAnimationFrame(() => {
        if (!disposed) {
          focusInteractiveTerminal(unlockInput);
        }
      });
      animationFrameIds.push(frameId);

      timeoutIds.push(
        window.setTimeout(() => {
          if (!disposed) {
            focusInteractiveTerminal(unlockInput);
          }
        }, 0),
      );

      timeoutIds.push(
        window.setTimeout(() => {
          if (!disposed) {
            focusInteractiveTerminal(unlockInput);
          }
        }, 32),
      );
    };

    const wsUrl = buildTerminalWebSocketUrl(agentSessionId, {
      replayBytes: mobileTouchMode ? MOBILE_TERMINAL_REPLAY_BYTES : undefined,
    });
    let ws: WebSocket | null = null;
    let activeTerminalSocketTracker: ReturnType<
      typeof registerTerminalWebSocket
    > | null = null;
    let replayComplete = false;
    let reconnectAttempt = 0;
    let reconnectTimerId: number | null = null;
    let connectionTimeoutId: number | null = null;
    let replaySafetyTimerId: number | null = null;
    let disconnectNoticeShown = false;
    let lastReportedTerminalFocus: "in" | "out" | null = null;
    const pendingInputBeforeReplay: Array<{
      data: string;
      recordForSafariRecovery: boolean;
    }> = [];
    let flushPendingInput = () => {};

    const terminalWantsFocusReports = () => {
      return (
        (
          term as Terminal & {
            modes?: { sendFocusMode?: boolean };
          }
        ).modes?.sendFocusMode ?? false
      );
    };

    const syncTerminalFocusReport = () => {
      if (!interactive || !inputEnabledRef.current) {
        return;
      }

      if (!terminalWantsFocusReports()) {
        lastReportedTerminalFocus = null;
        return;
      }

      if (ws?.readyState !== WebSocket.OPEN) {
        return;
      }

      // The first sync after a TUI opts into focus tracking (DECSET 1004)
      // must optimistically report focus-in. Otherwise a transient
      // `document.activeElement !== helperTextarea` observed while the
      // terminal is still being (re)mounted or while xterm is flushing its
      // handshake reply would be reported as focus-out, and TUIs like
      // Copilot CLI then silently drop the user's first keystrokes until a
      // focus-in ever comes back. Subsequent focus/blur events on the
      // helper textarea will correct this if the terminal is in fact not
      // focused.
      if (lastReportedTerminalFocus === null) {
        if (!ensureInputOwner()) {
          return;
        }
        ws.send("\u001b[I");
        lastReportedTerminalFocus = "in";
        return;
      }

      const nextFocusState =
        document.activeElement === getHelperTextarea() ? "in" : "out";
      if (lastReportedTerminalFocus === nextFocusState) {
        return;
      }

      if (!ensureInputOwner()) {
        return;
      }

      ws.send(nextFocusState === "in" ? "\u001b[I" : "\u001b[O");
      lastReportedTerminalFocus = nextFocusState;
    };

    const scheduleTerminalFocusReport = () => {
      timeoutIds.push(
        window.setTimeout(() => {
          if (!disposed) {
            syncTerminalFocusReport();
          }
        }, 0),
      );
    };

    const reportFocusedTerminalBeforeInput = () => {
      if (document.activeElement === getHelperTextarea()) {
        syncTerminalFocusReport();
      }
    };

    const clearReplaySafetyTimer = () => {
      if (replaySafetyTimerId === null) {
        return;
      }

      window.clearTimeout(replaySafetyTimerId);
      replaySafetyTimerId = null;
    };

    const armReplaySafetyTimer = () => {
      clearReplaySafetyTimer();
      replaySafetyTimerId = window.setTimeout(() => {
        replaySafetyTimerId = null;
        if (!disposed && ws?.readyState === WebSocket.OPEN) {
          replayCompletionObserved = true;
          enableTerminalInput();
          reportInitialReadyIfSettled();
        }
      }, 8_000);
    };

    const clearTerminalConnectionTimeout = (socket?: WebSocket) => {
      if (socket && socket !== ws) {
        return;
      }
      if (connectionTimeoutId === null) {
        return;
      }

      window.clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    };

    const armTerminalConnectionTimeout = (socket: WebSocket) => {
      clearTerminalConnectionTimeout();
      connectionTimeoutId = window.setTimeout(() => {
        connectionTimeoutId = null;
        if (
          disposed ||
          socket !== ws ||
          socket.readyState !== WebSocket.CONNECTING
        ) {
          return;
        }

        // A proxy can leave the browser socket in CONNECTING indefinitely.
        // Closing it forces the normal onclose retry path instead of leaving
        // xterm stdin locked forever.
        socket.close();
      }, TERMINAL_CONNECT_TIMEOUT_MS);
    };

    const scheduleTerminalReconnect = () => {
      if (disposed || reconnectTimerId !== null) {
        return;
      }

      const delay = computeTerminalReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        connectTerminalWebSocket();
      }, delay);
    };

    const connectTerminalWebSocket = () => {
      if (disposed) {
        return;
      }

      replayComplete = false;
      if (!initialReadyReported) {
        replayCompletionObserved = false;
      }
      terminalInputReadyRef.current = false;
      term.options.disableStdin = false;
      lastReportedTerminalFocus = null;

      const tracker = registerTerminalWebSocket(agentSessionId);
      const socket = new WebSocket(wsUrl);
      activeTerminalSocketTracker = tracker;
      ws = socket;
      wsRef.current = socket;

      socket.onmessage = (event) => {
        if (disposed || socket !== ws) {
          return;
        }

        reconnectAttempt = 0;
        if (typeof event.data === "string") {
          handleTerminalFrame(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.text().then((text) => {
            if (!disposed && socket === ws) {
              handleTerminalFrame(text);
            }
          });
        }
      };

      socket.onopen = () => {
        clearTerminalConnectionTimeout(socket);
        tracker.markOpen();
        if (disposed || closeAfterOpen || socket !== ws) {
          socket.close();
          return;
        }

        armReplaySafetyTimer();
        flushResize();
        scheduleFit();
        scheduleFocusInteractiveTerminal();
        scheduleTerminalFocusReport();
      };

      socket.onclose = () => {
        clearTerminalConnectionTimeout(socket);
        tracker.markClosed();
        if (activeTerminalSocketTracker === tracker) {
          activeTerminalSocketTracker = null;
        }
        if (disposed || socket !== ws) {
          return;
        }

        clearReplaySafetyTimer();
        ws = null;
        wsRef.current = null;
        replayComplete = false;
        terminalInputReadyRef.current = false;
        term.options.disableStdin = false;
        lastReportedTerminalFocus = null;
        if (!disconnectNoticeShown) {
          disconnectNoticeShown = true;
          writeTerminalOutput(
            "\r\n\x1b[33m[连接已断开，正在自动重连]\x1b[0m\r\n",
          );
        }
        scheduleTerminalReconnect();
      };

      armTerminalConnectionTimeout(socket);
    };

    const connectTimeoutId = window.setTimeout(connectTerminalWebSocket, 0);

    const flushResize = () => {
      if (isPreview) {
        return;
      }

      const size = pendingResizeRef.current;
      if (!size || ws?.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.send(
        JSON.stringify({
          type: "resize",
          cols: size.cols,
          rows: size.rows,
        }),
      );
    };

    const fitTerminal = () => {
      if (
        !isTerminalViewportMeasurable(
          container.clientWidth,
          container.clientHeight,
        )
      ) {
        return;
      }

      try {
        applyPreviewLayout();
        fitAddon.fit();
        if (term.cols > 0 && term.rows > 0) {
          cachePreviewGeometry(term.cols, term.rows);
        }
        term.refresh(0, Math.max(term.rows - 1, 0));
      } catch {
        /* container may not be measurable yet */
      }
    };

    const fitScheduler = createCoalescedTrailingScheduler({
      cancelFrame: window.cancelAnimationFrame.bind(window),
      clearTimer: window.clearTimeout.bind(window),
      requestFrame: window.requestAnimationFrame.bind(window),
      run: fitTerminal,
      scheduleTimer: window.setTimeout.bind(window),
    });

    const scheduleFit = () => {
      fitScheduler.schedule();
    };

    if (mobileTouchMode && interactive) {
      const touchState: {
        lastY: number;
        mode: "idle" | "pinch" | "scroll";
        scrollRemainder: number;
        startDistance: number;
        startFontSize: number;
      } = {
        lastY: 0,
        mode: "idle",
        scrollRemainder: 0,
        startDistance: 0,
        startFontSize: initialFontSize,
      };

      const shouldIgnoreMobileTouch = (target: EventTarget | null) =>
        target instanceof HTMLElement &&
        target.closest(".terminal-mobile-bottom-btn") !== null;

      const preventMobileTouchDefault = (event: TouchEvent) => {
        if (event.cancelable) {
          event.preventDefault();
        }
      };

      handleMobileTouchStart = (event) => {
        if (shouldIgnoreMobileTouch(event.target)) {
          return;
        }

        if (event.touches.length === 1) {
          preventMobileTouchDefault(event);
          touchState.mode = "scroll";
          touchState.lastY = event.touches[0]!.clientY;
          touchState.scrollRemainder = 0;
          return;
        }

        if (event.touches.length >= 2) {
          preventMobileTouchDefault(event);
          touchState.mode = "pinch";
          touchState.startDistance = measureTouchDistance(
            event.touches[0]!,
            event.touches[1]!,
          );
          touchState.startFontSize =
            typeof term.options.fontSize === "number"
              ? term.options.fontSize
              : initialFontSize;
        }
      };

      handleMobileTouchMove = (event) => {
        if (shouldIgnoreMobileTouch(event.target)) {
          return;
        }

        if (event.touches.length === 1 && touchState.mode === "scroll") {
          preventMobileTouchDefault(event);
          const nextY = event.touches[0]!.clientY;
          const deltaY = nextY - touchState.lastY;
          const result = computeMobileTerminalScrollLines({
            accumulatedDeltaY: touchState.scrollRemainder + deltaY,
            lineHeight: getTerminalLineHeight(),
          });

          touchState.lastY = nextY;
          touchState.scrollRemainder = result.remainingDeltaY;
          if (result.scrollLines !== 0) {
            term.scrollLines(result.scrollLines);
          }
          return;
        }

        if (event.touches.length >= 2) {
          preventMobileTouchDefault(event);
          const nextDistance = measureTouchDistance(
            event.touches[0]!,
            event.touches[1]!,
          );
          const nextFontSize = computeMobilePinchFontSize({
            currentDistance: nextDistance,
            startDistance: touchState.startDistance,
            startFontSize: touchState.startFontSize,
          });

          if (nextFontSize !== term.options.fontSize) {
            term.options.fontSize = nextFontSize;
            saveMobileTerminalFontSize(nextFontSize);
            onFontSizeChangeRef.current?.(nextFontSize);
            fitTerminal();
            flushResize();
          }
        }
      };

      handleMobileTouchEnd = (event) => {
        if (shouldIgnoreMobileTouch(event.target)) {
          return;
        }

        if (event.touches.length === 0) {
          touchState.mode = "idle";
          touchState.scrollRemainder = 0;
          return;
        }

        if (event.touches.length === 1) {
          touchState.mode = "scroll";
          touchState.lastY = event.touches[0]!.clientY;
          touchState.scrollRemainder = 0;
          return;
        }

        touchState.mode = "pinch";
        touchState.startDistance = measureTouchDistance(
          event.touches[0]!,
          event.touches[1]!,
        );
        touchState.startFontSize =
          typeof term.options.fontSize === "number"
            ? term.options.fontSize
            : initialFontSize;
      };

      container.addEventListener(
        "touchstart",
        handleMobileTouchStart,
        MOBILE_TOUCH_LISTENER_OPTIONS,
      );
      container.addEventListener(
        "touchmove",
        handleMobileTouchMove,
        MOBILE_TOUCH_LISTENER_OPTIONS,
      );
      container.addEventListener(
        "touchend",
        handleMobileTouchEnd,
        MOBILE_TOUCH_LISTENER_OPTIONS,
      );
      container.addEventListener(
        "touchcancel",
        handleMobileTouchEnd,
        MOBILE_TOUCH_LISTENER_OPTIONS,
      );
    }

    const enableTerminalInput = () => {
      if (replayComplete) {
        return;
      }

      clearReplaySafetyTimer();
      replayComplete = true;
      reconnectAttempt = 0;
      disconnectNoticeShown = false;
      terminalInputReadyRef.current = true;
      // Keep xterm stdin enabled even for monitor-only previews so terminal
      // protocol replies such as CPR/DA can be generated and forwarded. Normal
      // user input from monitor panes is still filtered in term.onData.
      term.options.disableStdin = false;
      flushPendingInput();
      if (inputEnabledRef.current) {
        scheduleFocusInteractiveTerminal();
        scheduleTerminalFocusReport();
      }
    };

    const handleTerminalFrame = (payload: string) => {
      recordTerminalFrame(payload);

      try {
        const parsed = JSON.parse(payload) as TerminalControlFrame;
        if (parsed.__agentOrchestrator !== "terminal-control") {
          const blocksInitialReady = !replayCompletionObserved;
          replayCompletionObserved = true;
          enableTerminalInput();
          writeTerminalOutput(payload, blocksInitialReady);
          scheduleTerminalFocusReport();
          reportInitialReadyIfSettled();
          return;
        }

        if (parsed.event === "replay" && typeof parsed.data === "string") {
          writeTerminalOutput(parsed.data, true);
          scheduleTerminalFocusReport();
          return;
        }

        if (parsed.event === "replay-complete") {
          replayCompletionObserved = true;
          enableTerminalInput();
          reportInitialReadyIfSettled();
        }
        return;
      } catch {
        const blocksInitialReady = !replayCompletionObserved;
        replayCompletionObserved = true;
        enableTerminalInput();
        writeTerminalOutput(payload, blocksInitialReady);
        scheduleTerminalFocusReport();
        reportInitialReadyIfSettled();
      }
    };

    const forwardTerminalInput = (
      data: string,
      recordForSafariRecovery: boolean,
    ): boolean => {
      const sanitized = stripTerminalResponsePayload(data);
      if (
        !terminalInputReadyRef.current &&
        inputEnabledRef.current &&
        sanitized.length > 0 &&
        !isTerminalProtocolResponsePayload(sanitized)
      ) {
        pendingInputBeforeReplay.push({
          data: sanitized,
          recordForSafariRecovery,
        });
        return true;
      }

      const socketOpen = ws?.readyState === WebSocket.OPEN;
      if (
        !shouldAttemptTerminalInputForward({
          inputEnabled: inputEnabledRef.current,
          terminalInputReady: terminalInputReadyRef.current,
          sanitizedPayload: sanitized,
          socketOpen,
        })
      ) {
        return false;
      }

      if (ws && (!inputEnabledRef.current || ensureInputOwner())) {
        reportFocusedTerminalBeforeInput();
        ws.send(sanitized);
        if (recoverSafariNativeInput && recordForSafariRecovery) {
          recordTerminalTextForSafariRecovery(
            safariInputRecoveryState,
            sanitized,
            performance.now(),
          );
        }
        return true;
      }

      return false;
    };

    flushPendingInput = () => {
      if (
        !terminalInputReadyRef.current ||
        pendingInputBeforeReplay.length === 0
      ) {
        return;
      }

      const pending = pendingInputBeforeReplay.splice(
        0,
        pendingInputBeforeReplay.length,
      );
      for (const item of pending) {
        forwardTerminalInput(item.data, item.recordForSafariRecovery);
      }
    };

    term.onData((data) => {
      forwardTerminalInput(data, true);
    });

    if (recoverSafariNativeInput) {
      handleSafariNativeInput = (event) => {
        const inputEvent = event as InputEvent;
        const target = inputEvent.target as HTMLTextAreaElement | null;
        if (
          !target ||
          target !== getHelperTextarea() ||
          inputEvent.inputType !== "insertText" ||
          inputEvent.isComposing ||
          !inputEvent.data
        ) {
          return;
        }

        const missingText = recoverSafariNativeTextInput(
          safariInputRecoveryState,
          inputEvent.data,
          performance.now(),
        );
        if (!missingText) {
          return;
        }

        target.value = "";
        forwardTerminalInput(missingText, false);
      };
      container.addEventListener("input", handleSafariNativeInput);
    }

    term.onBinary((data) => {
      const sanitized = stripTerminalResponsePayload(data);
      if (
        !terminalInputReadyRef.current &&
        inputEnabledRef.current &&
        sanitized.length > 0 &&
        !isTerminalProtocolResponsePayload(sanitized)
      ) {
        pendingInputBeforeReplay.push({
          data: sanitized,
          recordForSafariRecovery: false,
        });
        return;
      }

      const socketOpen = ws?.readyState === WebSocket.OPEN;
      if (
        !shouldAttemptTerminalInputForward({
          inputEnabled: inputEnabledRef.current,
          terminalInputReady: terminalInputReadyRef.current,
          sanitizedPayload: sanitized,
          socketOpen,
        })
      ) {
        return;
      }

      if (ws && (!inputEnabledRef.current || ensureInputOwner())) {
        reportFocusedTerminalBeforeInput();
        ws.send(
          JSON.stringify({
            type: "binary",
            data: btoa(sanitized),
          }),
        );
      }
    });

    if (interactive) {
      handleTerminalBlurCapture = (event) => {
        const related = event.relatedTarget as HTMLElement | null;
        const relatedTerminal = related?.closest(
          ".terminal-view",
        ) as HTMLElement | null;
        if (!relatedTerminal || relatedTerminal === container) {
          return;
        }

        const relatedHelper = related?.closest(".xterm-helper-textarea");
        if (!relatedHelper) {
          return;
        }

        // xterm refreshes the cursor row on every textarea blur. During a
        // pane-to-pane handoff that redraws an otherwise unchanged monitor;
        // focus reporting still goes through our focusout handler below.
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) {
          target.value = "";
        }
        event.stopImmediatePropagation();
        term.element?.classList.remove("focus");
      };

      const repairPassiveFocusDrift = () => {
        if (!inputEnabledRef.current) {
          return;
        }

        const helperTextarea = getHelperTextarea();
        if (
          !shouldRepairPassiveTerminalFocus({
            documentHasFocus: document.hasFocus(),
            helperAvailable: helperTextarea !== null,
            helperFocused: document.activeElement === helperTextarea,
            intentionalExternalFocus: isIntentionalExternalFocus(),
            lastExternalUserIntentAt,
            lastTerminalIntentAt,
          })
        ) {
          return;
        }

        focusInteractiveTerminal();
        syncTerminalFocusReport();
      };

      handleTerminalFocusIn = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("xterm-helper-textarea")) {
          return;
        }

        rememberTerminalIntent();
        scheduleTerminalFocusReport();
      };

      term.attachCustomWheelEventHandler((event) => {
        if (shouldAllowTerminalWheelToBubble({ wheelPassthrough })) {
          return true;
        }

        if (shouldForwardWheelToApplication(event)) {
          return true;
        }

        scrollTerminalWithWheel(event);
        return false;
      });

      handlePointerDownCapture = (event: PointerEvent) => {
        if (!inputEnabledRef.current) {
          return;
        }

        if (isProtectedExternalFocusTarget(event.target as HTMLElement)) {
          rememberExternalPointerIntent(event.target);
          return;
        }

        rememberTerminalIntent();
        focusInteractiveTerminal(true);
      };

      handleMouseDownCapture = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        rememberTerminalIntent();
        focusInteractiveTerminal(true);
        beginPreferredMouseGesture(event);
      };

      handleTerminalFocusOut = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("xterm-helper-textarea")) {
          return;
        }

        scheduleTerminalFocusReport();

        // If focus moved to a transient element (e.g. a button) we must
        // reclaim it immediately so the next keystroke reaches the terminal
        // rather than being swallowed by the button or dropped by a TUI that
        // saw a spurious focus-out.  A setTimeout deferral is too late for
        // fast typists or Playwright-driven tests.
        const related = event.relatedTarget as HTMLElement | null;
        const isTransient =
          related instanceof HTMLButtonElement ||
          related?.closest("button") != null;
        const isPointerDrivenTransient =
          isTransient &&
          Date.now() - lastExternalPointerIntentAt <= EXTERNAL_FOCUS_GRACE_MS;

        if (
          isPointerDrivenTransient &&
          !disposed &&
          !isIntentionalExternalFocus()
        ) {
          focusInteractiveTerminal(true);
          syncTerminalFocusReport();
          return;
        }

        if (isTransient) {
          scheduleTerminalFocusReport();
          return;
        }

        timeoutIds.push(
          window.setTimeout(() => {
            if (disposed || isIntentionalExternalFocus()) {
              return;
            }

            scheduleFocusInteractiveTerminal();
          }, 0),
        );
      };

      handleWindowFocus = () => {
        if (!inputEnabledRef.current) {
          return;
        }

        scheduleFocusInteractiveTerminal();
        scheduleTerminalFocusReport();
      };

      handleWindowBlur = () => {
        if (!inputEnabledRef.current) {
          return;
        }

        rememberActiveExternalFocusIfUserDriven();

        timeoutIds.push(
          window.setTimeout(() => {
            if (!disposed) {
              rememberActiveExternalFocusIfUserDriven();
            }
          }, 0),
        );
      };

      handleDocumentPointerDownCapture = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        rememberExternalPointerIntent(event.target);
      };

      handleDocumentFocusInCapture = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        rememberExternalFocusIfUserDriven(event.target);
      };

      handleDocumentKeyDownCapture = (event) => {
        if (!inputEnabledRef.current) {
          return;
        }

        const target = event.target as HTMLElement | null;
        if (
          target &&
          !target.closest(".terminal-view") &&
          isProtectedExternalFocusTarget(target)
        ) {
          rememberExternalUserIntent();
        }
      };

      container.addEventListener("pointerdown", handlePointerDownCapture, true);
      container.addEventListener("mousedown", handleMouseDownCapture, true);
      container.addEventListener("focusin", handleTerminalFocusIn, true);
      container.addEventListener("focusout", handleTerminalFocusOut, true);
      container.addEventListener("blur", handleTerminalBlurCapture, true);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("focus", handleWindowFocus);
      document.addEventListener(
        "pointerdown",
        handleDocumentPointerDownCapture,
        true,
      );
      document.addEventListener("focusin", handleDocumentFocusInCapture, true);
      document.addEventListener("keydown", handleDocumentKeyDownCapture, true);
      intervalIds.push(
        window.setInterval(
          repairPassiveFocusDrift,
          PASSIVE_FOCUS_REPAIR_INTERVAL_MS,
        ),
      );
      scheduleFocusInteractiveTerminal();
    }

    handleTerminalWheelCapture = (event) => {
      if (shouldCaptureTerminalWheel({ wheelPassthrough }) === false) {
        return;
      }

      if (shouldForwardWheelToApplication(event)) {
        rememberTerminalIntent();
        focusInteractiveTerminal(true);
        return;
      }

      scrollTerminalWithWheel(event);
    };

    handleDocumentWheelCapture = (event) => {
      if (shouldCaptureTerminalWheel({ wheelPassthrough }) === false) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      if (isTerminalWheelBlockedByOverlayTarget(event.target)) {
        return;
      }

      const path = event.composedPath();
      if (path.includes(container)) {
        return;
      }

      if (!eventPointIsInsideContainer(event)) {
        return;
      }

      scrollTerminalWithWheel(event);
    };

    document.addEventListener("wheel", handleDocumentWheelCapture, {
      capture: true,
      passive: false,
    });
    container.addEventListener("wheel", handleTerminalWheelCapture, {
      capture: true,
      passive: false,
    });

    term.onResize(({ cols, rows }) => {
      if (!isPreview) {
        cachePreviewGeometry(cols, rows);
        pendingResizeRef.current = { cols, rows };
        flushResize();
      }
    });

    scheduleFit();

    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => {
        scheduleFit();
      });
    }

    const handleWindowResize = () => {
      scheduleFit();
    };
    window.addEventListener("resize", handleWindowResize);

    let lastObservedContainerSize: { width: number; height: number } | null =
      null;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.round(
        entry?.contentRect.width ?? container.clientWidth,
      );
      const height = Math.round(
        entry?.contentRect.height ?? container.clientHeight,
      );
      if (!isTerminalViewportMeasurable(width, height)) {
        return;
      }
      if (
        lastObservedContainerSize?.width === width &&
        lastObservedContainerSize.height === height
      ) {
        return;
      }
      lastObservedContainerSize = { width, height };

      if (container.closest(".main-layout--resizing")) {
        fitScheduler.scheduleTrailing();
      } else {
        scheduleFit();
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
      osc52ClipboardDisposable.dispose();
      stage.removeEventListener("mouseup", handleStageMouseUp);
      stage.removeEventListener("keydown", handleStageCopyKey);
      clearPreferredMouseGesture?.();
      if (handlePointerDownCapture) {
        container.removeEventListener(
          "pointerdown",
          handlePointerDownCapture,
          true,
        );
      }
      if (handleMouseDownCapture) {
        container.removeEventListener(
          "mousedown",
          handleMouseDownCapture,
          true,
        );
      }
      if (handleTerminalFocusOut) {
        container.removeEventListener("focusout", handleTerminalFocusOut, true);
      }
      if (handleTerminalFocusIn) {
        container.removeEventListener("focusin", handleTerminalFocusIn, true);
      }
      if (handleTerminalBlurCapture) {
        container.removeEventListener("blur", handleTerminalBlurCapture, true);
      }
      if (handleMobileTouchStart) {
        container.removeEventListener(
          "touchstart",
          handleMobileTouchStart,
          MOBILE_TOUCH_LISTENER_OPTIONS,
        );
      }
      if (handleMobileTouchMove) {
        container.removeEventListener(
          "touchmove",
          handleMobileTouchMove,
          MOBILE_TOUCH_LISTENER_OPTIONS,
        );
      }
      if (handleMobileTouchEnd) {
        container.removeEventListener(
          "touchend",
          handleMobileTouchEnd,
          MOBILE_TOUCH_LISTENER_OPTIONS,
        );
        container.removeEventListener(
          "touchcancel",
          handleMobileTouchEnd,
          MOBILE_TOUCH_LISTENER_OPTIONS,
        );
      }
      if (handleTerminalWheelCapture) {
        container.removeEventListener(
          "wheel",
          handleTerminalWheelCapture,
          true,
        );
      }
      if (handleDocumentWheelCapture) {
        document.removeEventListener("wheel", handleDocumentWheelCapture, true);
      }
      if (handleDocumentPointerDownCapture) {
        document.removeEventListener(
          "pointerdown",
          handleDocumentPointerDownCapture,
          true,
        );
      }
      if (handleDocumentFocusInCapture) {
        document.removeEventListener(
          "focusin",
          handleDocumentFocusInCapture,
          true,
        );
      }
      if (handleDocumentKeyDownCapture) {
        document.removeEventListener(
          "keydown",
          handleDocumentKeyDownCapture,
          true,
        );
      }
      if (handleSafariNativeInput) {
        container.removeEventListener("input", handleSafariNativeInput);
      }
      if (handleWindowFocus) {
        window.removeEventListener("focus", handleWindowFocus);
      }
      if (handleWindowBlur) {
        window.removeEventListener("blur", handleWindowBlur);
      }
      window.clearTimeout(connectTimeoutId);
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
      clearTerminalConnectionTimeout();
      clearReplaySafetyTimer();
      fitScheduler.dispose();
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      for (const intervalId of intervalIds) {
        window.clearInterval(intervalId);
      }
      for (const animationFrameId of animationFrameIds) {
        window.cancelAnimationFrame(animationFrameId);
      }

      const currentOwner = terminalInputOwners.get(agentSessionId);
      if (currentOwner?.token === ownerToken) {
        terminalInputOwners.delete(agentSessionId);
      }

      if (ws?.readyState === WebSocket.CONNECTING) {
        closeAfterOpen = true;
      } else if (ws?.readyState === WebSocket.OPEN) {
        ws.close();
      }
      activeTerminalSocketTracker?.markClosed();
      activeTerminalSocketTracker = null;

      term.dispose();
      delete container.__xterm;
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
      pendingResizeRef.current = null;
      terminalInputReadyRef.current = false;
      pendingInputBeforeReplay.length = 0;
    };
  }, [
    agentSessionId,
    interactive,
    mobileTouchMode,
    preferLocalMouseSelection,
    restoreBracketedPasteMode,
    suspended,
    wheelPassthrough,
  ]);

  return (
    <div
      ref={containerRef}
      className={`terminal-view ${interactive ? "terminal-view-live" : "terminal-view-preview"} ${inputEnabled ? "terminal-view-input-active" : "terminal-view-input-monitor"}${mobileTouchMode ? " terminal-view-mobile-touch" : ""}${wheelPassthrough ? " terminal-view-wheel-passthrough" : ""}`}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const filePath = e.dataTransfer.getData("text/plain");
        if (filePath && interactive && inputEnabled) {
          const textarea = termRef.current?.textarea;
          if (textarea) {
            textarea.focus();
          }
          const term = termRef.current;
          if (term) {
            term.write(filePath + " ");
          }
        }
      }}
    >
      {!interactive && !suspended && (
        <div ref={stageRef} className="terminal-view-stage" />
      )}
      {mobileTouchMode && interactive && (
        <button
          className="terminal-mobile-bottom-btn"
          onClick={() => {
            userScrollLockedRef.current = false;
            termRef.current?.scrollToBottom();
          }}
          title="回到终端底部并继续看最新输出"
          type="button"
        >
          底部
        </button>
      )}
    </div>
  );
});
