import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  AgentSessionRecord,
  AppVersionResponse,
  ListAgentSessionsResponse,
  SshHostPreset,
} from "@agent-orchestrator/shared";

import { AgentFocusView } from "./components/AgentFocusView";
import { AgentGrid } from "./components/AgentGrid";
import {
  AppUpdateBanner,
  getRestoreBannerAutoDismissMs,
  shouldAutoDismissRestoreBanner,
  type AppUpdateBannerState,
} from "./components/AppUpdateBanner";
import type { DiscoveryMode } from "./components/DiscoveryDialog";
import { DiscoveryDialog } from "./components/DiscoveryDialog";
import type { AddToGridItem } from "./components/DiscoveryDialog";
import { FileBrowserDrawer } from "./components/FileBrowserDrawer";
import type { FilterState } from "./components/FilterBar";
import { HiddenSessionsDrawer } from "./components/HiddenSessionsDrawer";
import type { SelectedHost } from "./components/HostDropdown";
import { MobileWorkbenchPage } from "./components/MobileWorkbenchPage";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { QuickTmuxConnect } from "./components/QuickTmuxConnect";
import { SidePanelView } from "./components/SidePanelView";
import { TopBar } from "./components/TopBar";
import { VSCodeDrawer } from "./components/VSCodeDrawer";
import {
  collectAgentCompletionNotificationEvents,
  createVisibilityNotificationTracker,
  dispatchAgentCompletionNotification,
  getAgentCompletionNotificationPermission,
  loadAgentCompletionNotificationsEnabled,
  requestAgentCompletionNotificationPermission,
  saveAgentCompletionNotificationsEnabled,
  type AgentCompletionNotificationPermission,
} from "./lib/agent-completion-notifications";
import {
  addDiscoveredTmux,
  applyAppUpdatePull,
  checkForAppUpdate,
  deleteAgentSession,
  focusAgentSession,
  getAppVersion,
  getSshHosts,
  hideAgentSession,
  killTmuxSession,
  launchPtyAgent,
  launchSshPtyAgent,
  listAgentSessions,
  reconnectAgentSession,
  restoreManagedAgentSessions,
  subscribeAgentSessions,
  unhideAgentSession,
  updateAgentSession,
  type ConnectionStatus,
} from "./lib/api";
import {
  acceptAppRevision,
  beginConfirmedAppPull,
  clearConfirmedAppPull,
  consumeRestoreAfterReload,
  dismissAppRevision,
  initializeAcceptedAppRevision,
  readAcceptedAppRevision,
  readConfirmedAppPullBaseline,
  readDismissedAppRevision,
  shouldOfferAppUpdate,
} from "./lib/app-update";
import {
  loadAgentGridSortMode,
  saveAgentGridSortMode,
  type AgentGridSortMode,
} from "./lib/agent-grid-sort";
import {
  deriveLayoutMode,
  loadLayoutState,
  saveLayoutState,
  type LayoutState,
} from "./lib/layout-store";
import {
  defaultFocusViewState,
  parseFocusViewState,
  type FocusViewState,
  type ViewMode,
} from "./lib/focus-view-state";
import {
  FILE_BROWSER_MIN_WIDTH,
  parseFileBrowserUiState,
  type FileBrowserUiState,
} from "./lib/file-browser-ui-state";
import {
  createLatestFrameValueScheduler,
  type LatestFrameValueScheduler,
} from "./lib/frame-schedulers";
import {
  parseInitialSidePanelTool,
  parseSidePanelSessionStates,
  type FileBrowserSessionState,
} from "./lib/side-panel-session-state";
import {
  buildDirectLaunchCommand,
  buildRemoteDirectLaunchCommand,
  wrapRemoteInteractiveCommand,
} from "./lib/session-matching";
import {
  addSessionGroup,
  assignSessionToGroup,
  deleteSessionGroup,
  getSessionGroupKey,
  loadSessionGroups,
  renameSessionGroup,
  saveSessionGroups,
  toggleSessionGroupCollapsed,
  type SessionGroupState,
} from "./lib/session-groups";
import { isVsCodeAvailable } from "./lib/side-panel-availability";
import {
  loadTerminalPreviewLightweightMode,
  saveTerminalPreviewLightweightMode,
} from "./lib/terminal-preview-mode";
import {
  clampTerminalFontSize,
  loadTerminalFontSize,
  saveTerminalFontSize,
} from "./lib/terminal-font-size";
import { shouldEnableMobileTerminalTouchMode } from "./lib/mobile-terminal-mode";
import { isMobileWorkbenchLocation } from "./lib/mobile-workbench-route";
import {
  MAX_CACHED_VSCODE_IFRAMES,
  loadVsCodeIframeCacheMode,
  releaseVsCodeCacheSessionIds,
  resolveLightweightTerminalPreviewForVsCodeCacheMode,
  resolveRenderedVsCodeSessionIds,
  saveVsCodeIframeCacheMode,
  toggleVsCodeIframeCacheMode,
  touchVsCodeCacheSessionIds,
  type VsCodeIframeCacheMode,
} from "./lib/vscode-cache";
import { copyTextToClipboard } from "./lib/clipboard";
import "./app.css";

type SidePanelTool = "files" | "vscode";

const FILE_BROWSER_UI_STORAGE_KEY = "file-browser-ui-state";
const SIDE_PANEL_SESSION_STORAGE_KEY = "side-panel-session-state";
const FOCUS_VIEW_STORAGE_KEY = "focus-view-state";
const APP_VERSION_POLL_INTERVAL_MS = 3_000;

function readMobileTerminalTouchMode(): boolean {
  return shouldEnableMobileTerminalTouchMode({
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
}

function loadInitialSidePanelTool(
  focusedId: string | null,
): SidePanelTool | null {
  try {
    return parseInitialSidePanelTool(
      localStorage.getItem(SIDE_PANEL_SESSION_STORAGE_KEY),
      focusedId,
    );
  } catch {
    return null;
  }
}

function buildFileBrowserDefaultHost(
  session: AgentSessionRecord,
  sshHosts: SshHostPreset[],
): SelectedHost {
  if (!session.sshTarget) {
    return { type: "local" };
  }

  const matchingPreset = sshHosts.find(
    (host) =>
      host.host === session.sshTarget?.host &&
      host.port === (session.sshTarget?.port ?? 22) &&
      (host.username ?? "") === (session.sshTarget?.username ?? "") &&
      (host.identityFile ?? "") === (session.sshTarget?.identityFile ?? ""),
  );

  if (matchingPreset) {
    return {
      type: "ssh",
      preset: {
        ...matchingPreset,
        defaultPath:
          session.workingDirectory?.trim() || matchingPreset.defaultPath || "~",
      },
    };
  }

  return {
    type: "ssh",
    preset: {
      name: session.hostId ?? session.sshTarget.host,
      host: session.sshTarget.host,
      port: session.sshTarget.port ?? 22,
      username: session.sshTarget.username,
      identityFile: session.sshTarget.identityFile,
      defaultPath: session.workingDirectory?.trim() || "~",
    },
  };
}

function buildDefaultSidePanelState(
  session: AgentSessionRecord,
  sshHosts: SshHostPreset[],
): FileBrowserSessionState {
  return {
    selectedHost: buildFileBrowserDefaultHost(session, sshHosts),
  };
}

function loadFileBrowserUiState(): FileBrowserUiState {
  try {
    return parseFileBrowserUiState(
      localStorage.getItem(FILE_BROWSER_UI_STORAGE_KEY),
    );
  } catch {
    return parseFileBrowserUiState(null);
  }
}

function saveFileBrowserUiState(state: FileBrowserUiState) {
  try {
    localStorage.setItem(FILE_BROWSER_UI_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function loadSidePanelSessionStates(): Record<string, FileBrowserSessionState> {
  try {
    return parseSidePanelSessionStates(
      localStorage.getItem(SIDE_PANEL_SESSION_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function saveSidePanelSessionStates(
  state: Record<string, FileBrowserSessionState>,
) {
  try {
    localStorage.setItem(SIDE_PANEL_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function loadFocusViewState(): FocusViewState {
  try {
    return parseFocusViewState(localStorage.getItem(FOCUS_VIEW_STORAGE_KEY));
  } catch {
    return defaultFocusViewState();
  }
}

function saveFocusViewState(state: FocusViewState) {
  try {
    localStorage.setItem(FOCUS_VIEW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  if (element.classList.contains("xterm-helper-textarea")) {
    return true;
  }

  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    ),
  );
}

export default function App() {
  const initialFocusViewState = useMemo(() => loadFocusViewState(), []);
  const initialSidePanelSessionStates = useMemo(
    () => loadSidePanelSessionStates(),
    [],
  );
  const [snapshot, setSnapshot] = useState<ListAgentSessionsResponse | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState<AppVersionResponse | null>(null);
  const [acceptedAppRevision, setAcceptedAppRevision] = useState<string | null>(
    () => readAcceptedAppRevision(localStorage),
  );
  const [dismissedAppRevision, setDismissedAppRevision] = useState<
    string | null
  >(() => readDismissedAppRevision(localStorage));
  const [dismissedAutoUpdateNotice, setDismissedAutoUpdateNotice] = useState<
    string | null
  >(null);
  const [confirmedPullBaseline, setConfirmedPullBaseline] = useState<
    string | null
  >(() => readConfirmedAppPullBaseline(localStorage));
  const [sessionRestoreState, setSessionRestoreState] =
    useState<AppUpdateBannerState>(() =>
      consumeRestoreAfterReload(localStorage)
        ? { kind: "restoring", total: 0 }
        : { kind: "idle" },
    );
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialFocusViewState.viewMode,
  );
  const [focusedId, setFocusedId] = useState<string | null>(
    initialFocusViewState.focusedId,
  );
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<
    string | null
  >(initialFocusViewState.focusedId);
  const [newSessionHost, setNewSessionHost] = useState<SelectedHost | null>(
    null,
  );
  const [quickTmuxOpen, setQuickTmuxOpen] = useState(false);
  const [fileBrowserUiState, setFileBrowserUiState] =
    useState<FileBrowserUiState>(loadFileBrowserUiState);
  const [fileBrowserSessionStates, setFileBrowserSessionStates] = useState<
    Record<string, FileBrowserSessionState>
  >(initialSidePanelSessionStates);
  const [openSidePanelTool, setOpenSidePanelTool] =
    useState<SidePanelTool | null>(() =>
      loadInitialSidePanelTool(initialFocusViewState.focusedId),
    );
  const [vscodeCacheSessionIds, setVscodeCacheSessionIds] = useState<string[]>(
    [],
  );
  const [layoutState, setLayoutState] = useState<LayoutState>(loadLayoutState);
  const [sessionGroups, setSessionGroups] =
    useState<SessionGroupState>(loadSessionGroups);
  const [sshHosts, setSshHosts] = useState<SshHostPreset[]>([]);
  const [discoveryState, setDiscoveryState] = useState<{
    open: boolean;
    mode: DiscoveryMode;
    host: SelectedHost;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [filters, setFilters] = useState<FilterState>({
    host: null,
    kind: null,
    transport: null,
    dirQuery: "",
    tag: null,
  });
  const [agentGridSortMode, setAgentGridSortMode] =
    useState<AgentGridSortMode>(loadAgentGridSortMode);
  const [useLightweightTerminalPreview, setUseLightweightTerminalPreview] =
    useState(loadTerminalPreviewLightweightMode);
  const [terminalFontSize, setTerminalFontSize] =
    useState(loadTerminalFontSize);
  const [
    agentCompletionNotificationsEnabled,
    setAgentCompletionNotificationsEnabled,
  ] = useState(loadAgentCompletionNotificationsEnabled);
  const [
    agentCompletionNotificationPermission,
    setAgentCompletionNotificationPermission,
  ] = useState<AgentCompletionNotificationPermission>(
    getAgentCompletionNotificationPermission,
  );
  const [vscodeIframeCacheMode, setVscodeIframeCacheMode] =
    useState<VsCodeIframeCacheMode>(loadVsCodeIframeCacheMode);
  const [mobileTerminalTouchMode, setMobileTerminalTouchMode] = useState(
    readMobileTerminalTouchMode,
  );
  const mainLayoutRef = useRef<HTMLDivElement | null>(null);
  const fileBrowserShellRef = useRef<HTMLDivElement | null>(null);
  const fileBrowserWidthSchedulerRef =
    useRef<LatestFrameValueScheduler<number> | null>(null);
  const fileBrowserResizeRef = useRef<{
    latestWidth: number;
    maxWidth: number;
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const previousNotificationSessionsRef = useRef<AgentSessionRecord[] | null>(
    null,
  );
  const notificationReadyAtRef = useRef(Date.now() + 5_000);
  const restoreAttemptedRuntimeIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const refreshVersion = () => {
      getAppVersion()
        .then((version) => {
          if (cancelled) {
            return;
          }

          setAppVersion(version);
          setAcceptedAppRevision((current) => {
            if (current) {
              return current;
            }
            return initializeAcceptedAppRevision(
              localStorage,
              version.sourceRevision,
            );
          });
        })
        .catch(() => {});
    };

    refreshVersion();
    const intervalId = window.setInterval(
      refreshVersion,
      APP_VERSION_POLL_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!appVersion || !confirmedPullBaseline) {
      return;
    }

    if (appVersion.sourceRevision !== confirmedPullBaseline) {
      clearConfirmedAppPull(localStorage);
      setConfirmedPullBaseline(null);
      acceptAppRevision(localStorage, appVersion.sourceRevision);
      window.location.reload();
      return;
    }

    const phase = appVersion.autoUpdate?.phase;
    if (
      phase === "conflict" ||
      phase === "error" ||
      phase === "available" ||
      phase === "idle"
    ) {
      clearConfirmedAppPull(localStorage);
      setConfirmedPullBaseline(null);
    }
  }, [appVersion, confirmedPullBaseline]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWithRetry<T>(
      fn: () => Promise<T>,
      retries = 3,
      delayMs = 1_000,
    ): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await fn();
        } catch (error) {
          if (attempt >= retries || cancelled) throw error;
          await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
        }
      }
    }

    fetchWithRetry(listAgentSessions)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    fetchWithRetry(getSshHosts)
      .then((res) => {
        if (cancelled) return;
        setSshHosts(res.hosts);
      })
      .catch(() => {});

    const unsubscribe = subscribeAgentSessions(
      (data) => {
        setSnapshot(data);
        setIsLoading(false);
      },
      (status) => {
        setConnectionStatus(status);
        if (status === "connected") {
          setIsLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!appVersion || isLoading || !snapshot) {
      return;
    }

    const managedSessions = snapshot.items.filter(
      (session) =>
        Boolean(session.transportRef?.tmuxSession) &&
        session.connectionState === "offline",
    );
    if (managedSessions.length === 0) {
      if (sessionRestoreState.kind === "restoring") {
        setSessionRestoreState({
          kind: "restore-complete",
          restored: 0,
          manualRecovery: snapshot.items.filter(
            (session) =>
              !session.transportRef?.tmuxSession &&
              session.connectionState === "offline",
          ).length,
        });
      }
      return;
    }

    if (restoreAttemptedRuntimeIdsRef.current.has(appVersion.runtimeId)) {
      return;
    }
    restoreAttemptedRuntimeIdsRef.current.add(appVersion.runtimeId);
    setSessionRestoreState({
      kind: "restoring",
      total: managedSessions.length,
    });

    restoreManagedAgentSessions()
      .then(async (result) => {
        const nextSnapshot = await listAgentSessions().catch(() => null);
        if (nextSnapshot) {
          setSnapshot(nextSnapshot);
        }

        if (result.failed.length > 0) {
          setSessionRestoreState({
            kind: "restore-failed",
            restored: result.restoredIds.length,
            failures: result.failed.map(
              (failure) => `${failure.displayName}: ${failure.error}`,
            ),
          });
          return;
        }

        setSessionRestoreState({
          kind: "restore-complete",
          restored: result.restoredIds.length,
          manualRecovery: result.manualRecoveryIds.length,
        });
      })
      .catch((error) => {
        setSessionRestoreState({
          kind: "restore-failed",
          restored: 0,
          failures: [error instanceof Error ? error.message : "恢复请求失败"],
        });
      });
  }, [appVersion, isLoading, sessionRestoreState.kind, snapshot]);

  useEffect(() => {
    const autoDismissMs = getRestoreBannerAutoDismissMs(sessionRestoreState);
    if (autoDismissMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSessionRestoreState((current) =>
        shouldAutoDismissRestoreBanner(current) ? { kind: "idle" } : current,
      );
    }, autoDismissMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [sessionRestoreState]);

  useEffect(() => {
    saveFileBrowserUiState(fileBrowserUiState);
  }, [fileBrowserUiState]);

  useEffect(() => {
    const scheduler = createLatestFrameValueScheduler<number>({
      apply: (width) => {
        if (fileBrowserShellRef.current) {
          fileBrowserShellRef.current.style.width = `${width}px`;
        }
      },
      cancelFrame: window.cancelAnimationFrame.bind(window),
      requestFrame: window.requestAnimationFrame.bind(window),
    });
    fileBrowserWidthSchedulerRef.current = scheduler;

    return () => {
      scheduler.cancel();
      fileBrowserWidthSchedulerRef.current = null;
      document.body.classList.remove("side-panel-resize-active");
    };
  }, []);

  useEffect(() => {
    saveSessionGroups(sessionGroups);
  }, [sessionGroups]);

  useEffect(() => {
    saveSidePanelSessionStates(fileBrowserSessionStates);
  }, [fileBrowserSessionStates]);

  useEffect(() => {
    saveFocusViewState({ viewMode, focusedId });
  }, [focusedId, viewMode]);

  useEffect(() => {
    saveTerminalPreviewLightweightMode(useLightweightTerminalPreview);
  }, [useLightweightTerminalPreview]);

  useEffect(() => {
    saveTerminalFontSize(terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    const currentSessions = snapshot?.items;
    if (!currentSessions) {
      return;
    }

    const previousSessions = previousNotificationSessionsRef.current;

    if (
      previousSessions &&
      agentCompletionNotificationsEnabled &&
      agentCompletionNotificationPermission === "granted" &&
      Date.now() >= notificationReadyAtRef.current
    ) {
      collectAgentCompletionNotificationEvents(
        previousSessions,
        currentSessions,
      ).forEach(dispatchAgentCompletionNotification);
    }

    previousNotificationSessionsRef.current = currentSessions;
  }, [
    agentCompletionNotificationPermission,
    agentCompletionNotificationsEnabled,
    snapshot,
  ]);

  const notificationStateRef = useRef({
    enabled: agentCompletionNotificationsEnabled,
    permission: agentCompletionNotificationPermission,
    sessions: snapshot?.items ?? null,
  });
  notificationStateRef.current = {
    enabled: agentCompletionNotificationsEnabled,
    permission: agentCompletionNotificationPermission,
    sessions: snapshot?.items ?? null,
  };

  useEffect(() => {
    return createVisibilityNotificationTracker(
      () => notificationStateRef.current.enabled,
      () => notificationStateRef.current.permission,
      () => notificationStateRef.current.sessions,
    );
  }, []);

  useEffect(() => {
    saveVsCodeIframeCacheMode(vscodeIframeCacheMode);
  }, [vscodeIframeCacheMode]);

  useEffect(() => {
    const pointerMedia = window.matchMedia?.("(pointer: coarse)");
    const refresh = () =>
      setMobileTerminalTouchMode(readMobileTerminalTouchMode());

    pointerMedia?.addEventListener("change", refresh);
    window.addEventListener("orientationchange", refresh);
    return () => {
      pointerMedia?.removeEventListener("change", refresh);
      window.removeEventListener("orientationchange", refresh);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setDiscoveryState({
          open: true,
          mode: "tmux",
          host: { type: "local" },
        });
        return;
      }

      if (event.key.toLowerCase() !== "e") {
        return;
      }

      event.preventDefault();
      setQuickTmuxOpen(true);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const sessions = snapshot?.items ?? [];
  const visibleSessions = sessions.filter((s) => !s.hidden);
  const hiddenSessions = sessions.filter((s) => s.hidden);
  const [showHiddenDrawer, setShowHiddenDrawer] = useState(false);

  useEffect(() => {
    if (isLoading || !snapshot) {
      return;
    }

    const knownIds = new Set(sessions.map((session) => session.id));
    setFileBrowserSessionStates((current) => {
      const nextEntries = Object.entries(current).filter(([id]) =>
        knownIds.has(id),
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });

    setVscodeCacheSessionIds((current) =>
      current.filter((sessionId) => knownIds.has(sessionId)),
    );

    if (!isLoading && focusedId && !knownIds.has(focusedId)) {
      setFocusedId(null);
      setActiveTerminalSessionId(null);
      setOpenSidePanelTool(null);
      setViewMode("grid");
    }

    if (activeTerminalSessionId && !knownIds.has(activeTerminalSessionId)) {
      setActiveTerminalSessionId(
        focusedId && knownIds.has(focusedId) ? focusedId : null,
      );
    }
  }, [activeTerminalSessionId, focusedId, isLoading, sessions]);

  const filteredSessions = visibleSessions.filter((s) => {
    if (filters.host && (s.hostId ?? "local") !== filters.host) return false;
    if (filters.kind && s.agentKind !== filters.kind) return false;
    if (filters.transport === "tmux" && !s.transportRef?.tmuxSession) {
      return false;
    }
    if (
      filters.dirQuery &&
      !(s.workingDirectory ?? "")
        .toLowerCase()
        .includes(filters.dirQuery.toLowerCase())
    )
      return false;
    if (filters.tag && !(s.tags ?? []).includes(filters.tag)) return false;
    return true;
  });

  const handleAgentGridSortModeChange = useCallback(
    (mode: AgentGridSortMode) => {
      setAgentGridSortMode(mode);
      saveAgentGridSortMode(mode);
    },
    [],
  );

  const acknowledgeFocusedSession = useCallback((id: string) => {
    focusAgentSession({ agentSessionId: id })
      .then(setSnapshot)
      .catch(() => {});
  }, []);

  function handleFocusSession(id: string) {
    setFocusedId(id);
    setActiveTerminalSessionId(id);
    setViewMode("focus");
    acknowledgeFocusedSession(id);
  }

  const handleQuickTmuxConnected = useCallback(
    (session: AgentSessionRecord) => {
      setSnapshot((current) => {
        const items = current?.items ?? [];
        return {
          items: [session, ...items.filter((item) => item.id !== session.id)],
          activeAgentSessionId: session.id,
          updatedAt: new Date().toISOString(),
        };
      });
      setFocusedId(session.id);
      setActiveTerminalSessionId(session.id);
      setViewMode("focus");
      setQuickTmuxOpen(false);

      listAgentSessions()
        .then(setSnapshot)
        .catch(() => {});
    },
    [],
  );

  const handleExitFocus = useCallback(() => {
    setViewMode("grid");
    setFocusedId(null);
    setActiveTerminalSessionId(null);
    setOpenSidePanelTool(null);
  }, []);

  function ensureSidePanelStateForSession(session: AgentSessionRecord) {
    setFileBrowserSessionStates((current) => {
      if (current[session.id]) {
        return current;
      }

      return {
        ...current,
        [session.id]: buildDefaultSidePanelState(session, sshHosts),
      };
    });
  }

  function closeSidePanelTool() {
    setOpenSidePanelTool(null);
  }

  function handleSwitchFocus(id: string) {
    const targetSession = sessions.find((session) => session.id === id);

    if (openSidePanelTool && targetSession) {
      ensureSidePanelStateForSession(targetSession);
    }

    setFocusedId(id);
    setActiveTerminalSessionId(id);
    acknowledgeFocusedSession(id);
  }

  const handleActiveTerminalSessionChange = useCallback(
    (id: string | null) => {
      setActiveTerminalSessionId(id);
      if (id) {
        acknowledgeFocusedSession(id);
      }
    },
    [acknowledgeFocusedSession],
  );

  const handleMobileSwitchSession = useCallback(
    (id: string) => {
      setFocusedId(id);
      setActiveTerminalSessionId(id);
      setViewMode("focus");
      acknowledgeFocusedSession(id);
    },
    [acknowledgeFocusedSession],
  );

  const mobileActiveSessionId = isMobileWorkbenchLocation(window.location)
    ? (visibleSessions.find(
        (session) =>
          session.id === (focusedId ?? snapshot?.activeAgentSessionId),
      )?.id ??
      visibleSessions[0]?.id ??
      null)
    : null;

  useEffect(() => {
    const viewedSessionId =
      mobileActiveSessionId ?? (viewMode === "focus" ? focusedId : null);
    if (!viewedSessionId) {
      return;
    }

    const viewedSession = snapshot?.items.find(
      (session) => session.id === viewedSessionId,
    );
    if (viewedSession?.hasUnreadCompletion) {
      acknowledgeFocusedSession(viewedSessionId);
    }
  }, [
    acknowledgeFocusedSession,
    focusedId,
    mobileActiveSessionId,
    snapshot,
    viewMode,
  ]);

  const handleToggleAgentCompletionNotifications = useCallback(async () => {
    if (agentCompletionNotificationsEnabled) {
      saveAgentCompletionNotificationsEnabled(false);
      setAgentCompletionNotificationsEnabled(false);
      setAgentCompletionNotificationPermission(
        getAgentCompletionNotificationPermission(),
      );
      return;
    }

    const permission = await requestAgentCompletionNotificationPermission();
    setAgentCompletionNotificationPermission(permission);
    const enabled = permission === "granted";
    saveAgentCompletionNotificationsEnabled(enabled);
    setAgentCompletionNotificationsEnabled(enabled);
  }, [agentCompletionNotificationsEnabled]);

  const handleLaunched = useCallback(
    (session: AgentSessionRecord, groupId: string | null) => {
      setSessionGroups((current) =>
        assignSessionToGroup(current, getSessionGroupKey(session), groupId),
      );
      listAgentSessions()
        .then(setSnapshot)
        .catch(() => {});
    },
    [],
  );

  async function handleDeleteSession(id: string) {
    await deleteAgentSession(id);
    listAgentSessions()
      .then(setSnapshot)
      .catch(() => {});
  }

  async function handleHideSession(id: string) {
    await hideAgentSession(id);
    const snap = await listAgentSessions().catch(() => null);
    if (snap) {
      setSnapshot(snap);
      if (snap.activeAgentSessionId === id) {
        const nextVisible = snap.items.find((s) => !s.hidden && s.id !== id);
        if (nextVisible) {
          focusAgentSession({ agentSessionId: nextVisible.id })
            .then(setSnapshot)
            .catch(() => {});
        }
      }
    }
  }

  async function handleUnhideSession(id: string) {
    await unhideAgentSession(id);
    listAgentSessions()
      .then(setSnapshot)
      .catch(() => {});
  }

  async function handleKillTmux(id: string) {
    await killTmuxSession(id);
    listAgentSessions()
      .then(setSnapshot)
      .catch(() => {});
  }

  function handleCopyConnectCommand(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (session?.transportRef?.tmuxSession) {
      const cmd = `tmux attach -t ${session.transportRef.tmuxSession}`;
      copyTextToClipboard(cmd).catch(() => {});
    }
  }

  async function handleReconnectSession(id: string) {
    await reconnectAgentSession(id);
    listAgentSessions()
      .then(setSnapshot)
      .catch(() => {});
  }

  const handleRenameSession = useCallback(
    async (id: string) => {
      const session = sessions.find((item) => item.id === id);
      if (!session) {
        return;
      }

      const nextName = window.prompt("输入新的会话名称", session.displayName);
      if (nextName === null) {
        return;
      }

      const displayName = nextName.trim();
      if (!displayName) {
        window.alert("名称不能为空");
        return;
      }

      if (displayName === session.displayName) {
        return;
      }

      try {
        await updateAgentSession(id, { displayName });
        listAgentSessions()
          .then(setSnapshot)
          .catch(() => {});
      } catch (error) {
        window.alert(
          `改名失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    },
    [sessions],
  );

  const handleCreateSessionGroup = useCallback(
    (sessionId?: string) => {
      const requestedName = window.prompt("输入新分组名称");
      if (requestedName === null) return;

      const name = requestedName.trim();
      if (!name) {
        window.alert("分组名称不能为空");
        return;
      }
      if (
        sessionGroups.groups.some(
          (group) =>
            group.name.localeCompare(name, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      ) {
        window.alert("分组名称已存在");
        return;
      }

      const randomId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const groupId = `group-${randomId}`;
      setSessionGroups((current) => {
        let next = addSessionGroup(current, { id: groupId, name });
        const session = sessionId
          ? sessions.find((item) => item.id === sessionId)
          : undefined;
        if (session) {
          next = assignSessionToGroup(
            next,
            getSessionGroupKey(session),
            groupId,
          );
        }
        return next;
      });
    },
    [sessionGroups.groups, sessions],
  );

  const handleRenameSessionGroup = useCallback(
    (groupId: string) => {
      const group = sessionGroups.groups.find((item) => item.id === groupId);
      if (!group) return;

      const requestedName = window.prompt("输入新的分组名称", group.name);
      if (requestedName === null) return;

      const name = requestedName.trim();
      if (!name) {
        window.alert("分组名称不能为空");
        return;
      }
      if (
        sessionGroups.groups.some(
          (item) =>
            item.id !== groupId &&
            item.name.localeCompare(name, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      ) {
        window.alert("分组名称已存在");
        return;
      }

      setSessionGroups((current) => renameSessionGroup(current, groupId, name));
    },
    [sessionGroups.groups],
  );

  const handleDeleteSessionGroup = useCallback(
    (groupId: string) => {
      const group = sessionGroups.groups.find((item) => item.id === groupId);
      if (!group) return;
      if (
        !window.confirm(`删除分组“${group.name}”？其中的卡片将回到未分组。`)
      ) {
        return;
      }

      setSessionGroups((current) => deleteSessionGroup(current, groupId));
    },
    [sessionGroups.groups],
  );

  const handleMoveSessionToGroup = useCallback(
    (sessionId: string, groupId: string | null) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;

      setSessionGroups((current) =>
        assignSessionToGroup(current, getSessionGroupKey(session), groupId),
      );
    },
    [sessions],
  );

  const handleToggleSessionGroup = useCallback(
    (groupId: string, scope?: string) => {
      setSessionGroups((current) =>
        toggleSessionGroupCollapsed(current, groupId, scope),
      );
    },
    [],
  );

  const focusedSession: AgentSessionRecord | undefined = focusedId
    ? sessions.find((s) => s.id === focusedId)
    : undefined;
  const activeTerminalSession: AgentSessionRecord | undefined =
    activeTerminalSessionId
      ? sessions.find((s) => s.id === activeTerminalSessionId)
      : undefined;
  const sidePanelTargetSession = activeTerminalSession ?? focusedSession;
  const focusedSidePanelState = useMemo(() => {
    if (!focusedSession) {
      return null;
    }

    return (
      fileBrowserSessionStates[focusedSession.id] ??
      buildDefaultSidePanelState(focusedSession, sshHosts)
    );
  }, [fileBrowserSessionStates, focusedSession, sshHosts]);
  const panelAvailable = viewMode === "focus" && Boolean(focusedSession);
  const fileBrowserAvailable = panelAvailable;
  const vscodeAvailable = isVsCodeAvailable({
    panelAvailable,
    focusedSession,
  });
  const fileBrowserOpen = panelAvailable && openSidePanelTool === "files";
  const vscodeOpen = panelAvailable && openSidePanelTool === "vscode";
  const sidePanelOpen = fileBrowserOpen || vscodeOpen;
  const activeVsCodeSessionId =
    vscodeOpen && focusedSession ? focusedSession.id : null;
  const renderedVsCodeSessionIds = useMemo(() => {
    return resolveRenderedVsCodeSessionIds({
      activeSessionId: activeVsCodeSessionId,
      cachedSessionIds: vscodeCacheSessionIds,
      maxCachedIframes: MAX_CACHED_VSCODE_IFRAMES,
      mode: vscodeIframeCacheMode,
    });
  }, [activeVsCodeSessionId, vscodeCacheSessionIds, vscodeIframeCacheMode]);
  const retainedVsCodeSessionIds = useMemo(
    () => releaseVsCodeCacheSessionIds(activeVsCodeSessionId),
    [activeVsCodeSessionId],
  );
  const vscodeCacheReleaseAvailable =
    vscodeCacheSessionIds.some(
      (sessionId) => !retainedVsCodeSessionIds.includes(sessionId),
    ) ||
    renderedVsCodeSessionIds.some(
      (sessionId) => !retainedVsCodeSessionIds.includes(sessionId),
    );
  const sidePanelRendered =
    sidePanelOpen || renderedVsCodeSessionIds.length > 0;
  const sidePanelCollapsed = sidePanelOpen && fileBrowserUiState.sideCollapsed;
  const mainPanelCollapsed = sidePanelOpen && fileBrowserUiState.mainCollapsed;

  useEffect(() => {
    if (!vscodeOpen || !focusedSession) {
      return;
    }

    setVscodeCacheSessionIds((current) => {
      return touchVsCodeCacheSessionIds(
        current,
        focusedSession.id,
        MAX_CACHED_VSCODE_IFRAMES,
      );
    });
  }, [focusedSession, vscodeOpen]);

  const layoutMode = deriveLayoutMode({
    ...layoutState,
    sidebarCollapsed: false,
  });
  const appUpdateAvailable = Boolean(
    appVersion &&
    shouldOfferAppUpdate(
      acceptedAppRevision,
      appVersion.sourceRevision,
      dismissedAppRevision,
    ),
  );
  const autoUpdateNotice = appVersion?.autoUpdate;
  const autoUpdateNoticeKey =
    autoUpdateNotice &&
    (autoUpdateNotice.phase === "available" ||
      autoUpdateNotice.phase === "conflict" ||
      autoUpdateNotice.phase === "error")
      ? [autoUpdateNotice.phase, autoUpdateNotice.remoteHead].join(":")
      : null;
  const autoUpdateNoticeVisible = Boolean(
    autoUpdateNoticeKey && autoUpdateNoticeKey !== dismissedAutoUpdateNotice,
  );
  const appUpdateBannerState: AppUpdateBannerState =
    autoUpdateNoticeVisible && autoUpdateNotice
      ? {
          kind:
            autoUpdateNotice.phase === "available"
              ? "remote-update-available"
              : autoUpdateNotice.phase === "conflict"
                ? "update-conflict"
                : "update-error",
          branch: autoUpdateNotice.branch,
          shortHead: autoUpdateNotice.remoteHead?.slice(0, 8) ?? null,
          message:
            autoUpdateNotice.message ??
            "自动更新未完成，请检查本地仓库状态后重新检查。",
        }
      : appUpdateAvailable && appVersion
        ? {
            kind: "update-available",
            branch: appVersion.gitBranch,
            shortHead: appVersion.gitHead?.slice(0, 8) ?? null,
          }
        : sessionRestoreState;

  function handleApplyAppUpdate() {
    if (!appVersion) {
      return;
    }

    acceptAppRevision(localStorage, appVersion.sourceRevision);
    window.location.reload();
  }

  function handleDismissAppUpdateBanner() {
    if (autoUpdateNoticeVisible && autoUpdateNoticeKey) {
      setDismissedAutoUpdateNotice(autoUpdateNoticeKey);
      return;
    }

    if (appUpdateAvailable && appVersion) {
      dismissAppRevision(localStorage, appVersion.sourceRevision);
      setDismissedAppRevision(appVersion.sourceRevision);
      return;
    }

    setSessionRestoreState({ kind: "idle" });
  }

  function beginPullAndHotUpdate() {
    if (!appVersion) {
      return;
    }

    const baselineRevision = appVersion.sourceRevision;
    beginConfirmedAppPull(localStorage, baselineRevision);
    setConfirmedPullBaseline(baselineRevision);
    setDismissedAutoUpdateNotice(null);
    setAppVersion((current) =>
      current?.autoUpdate
        ? {
            ...current,
            autoUpdate: {
              ...current.autoUpdate,
              phase: "checking",
              conflictReason: null,
              message: null,
            },
          }
        : current,
    );

    applyAppUpdatePull()
      .then((status) => {
        setAppVersion((current) =>
          current ? { ...current, autoUpdate: status } : current,
        );
        if (status.phase !== "updated") {
          clearConfirmedAppPull(localStorage);
          setConfirmedPullBaseline(null);
        }
      })
      .catch(() => {
        void getAppVersion()
          .then(setAppVersion)
          .catch(() => {});
      });
  }

  function handleRetryAppUpdate() {
    if (appVersion?.autoUpdate?.phase === "conflict") {
      beginPullAndHotUpdate();
      return;
    }

    setDismissedAutoUpdateNotice(null);
    setAppVersion((current) =>
      current?.autoUpdate
        ? {
            ...current,
            autoUpdate: {
              ...current.autoUpdate,
              phase: "checking",
              conflictReason: null,
              message: null,
            },
          }
        : current,
    );

    checkForAppUpdate()
      .then((status) => {
        setAppVersion((current) =>
          current ? { ...current, autoUpdate: status } : current,
        );
      })
      .catch(() => {
        void getAppVersion()
          .then(setAppVersion)
          .catch(() => {});
      });
  }

  function updateLayout(partial: Partial<LayoutState>) {
    setLayoutState((prev) => {
      const next = { ...prev, ...partial };
      saveLayoutState(next);
      return next;
    });
  }

  function handleScanTmux(host: SelectedHost) {
    setDiscoveryState({ open: true, mode: "tmux", host });
  }

  function handleScanApps(host: SelectedHost) {
    setDiscoveryState({ open: true, mode: "apps", host });
  }

  function handleToggleVsCodeIframeCacheMode() {
    const next = toggleVsCodeIframeCacheMode(vscodeIframeCacheMode);

    setVscodeIframeCacheMode(next);
    setUseLightweightTerminalPreview(
      resolveLightweightTerminalPreviewForVsCodeCacheMode(next),
    );

    if (next === "memory-saving") {
      setVscodeCacheSessionIds(retainedVsCodeSessionIds);
    }
  }

  const handleTerminalFontSizeChange = useCallback((fontSize: number) => {
    setTerminalFontSize(clampTerminalFontSize(fontSize));
  }, []);

  function handleReleaseVsCodeIframeCache() {
    setVscodeCacheSessionIds(retainedVsCodeSessionIds);
  }

  function handleDiscoveryClose() {
    setDiscoveryState(null);
  }

  const beginFileBrowserResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        sidePanelCollapsed ||
        mainPanelCollapsed ||
        (event.target as HTMLElement).closest("button")
      ) {
        return;
      }

      const mainLayout = mainLayoutRef.current;
      const fileBrowserShell = fileBrowserShellRef.current;
      if (!mainLayout || !fileBrowserShell) {
        return;
      }

      const startWidth = fileBrowserShell.getBoundingClientRect().width;
      fileBrowserResizeRef.current = {
        latestWidth: startWidth,
        maxWidth: Math.max(420, mainLayout.clientWidth - 320),
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
      };
      mainLayout.classList.add("main-layout--resizing");
      document.body.classList.add("side-panel-resize-active");
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [mainPanelCollapsed, sidePanelCollapsed],
  );

  const updateFileBrowserWidth = useCallback((clientX: number) => {
    const resizeState = fileBrowserResizeRef.current;
    if (!resizeState) {
      return;
    }

    const delta = clientX - resizeState.startX;
    const nextWidth = Math.min(
      resizeState.maxWidth,
      Math.max(FILE_BROWSER_MIN_WIDTH, resizeState.startWidth + delta),
    );

    if (nextWidth === resizeState.latestWidth) {
      return;
    }

    resizeState.latestWidth = nextWidth;
    fileBrowserWidthSchedulerRef.current?.schedule(nextWidth);
  }, []);

  const endFileBrowserResize = useCallback(() => {
    const resizeState = fileBrowserResizeRef.current;
    if (!resizeState) {
      return;
    }

    fileBrowserWidthSchedulerRef.current?.flush();
    fileBrowserResizeRef.current = null;
    mainLayoutRef.current?.classList.remove("main-layout--resizing");
    document.body.classList.remove("side-panel-resize-active");
    setFileBrowserUiState((current: FileBrowserUiState) =>
      current.width === resizeState.latestWidth
        ? current
        : { ...current, width: resizeState.latestWidth },
    );
  }, []);

  const toggleSidePanelCollapsed = useCallback(() => {
    if (!sidePanelOpen) {
      return;
    }

    setFileBrowserUiState((current: FileBrowserUiState) => {
      const nextSideCollapsed = !current.sideCollapsed;
      return {
        ...current,
        sideCollapsed: nextSideCollapsed,
        mainCollapsed: nextSideCollapsed ? false : current.mainCollapsed,
      };
    });
  }, [sidePanelOpen]);

  const toggleMainPanelCollapsed = useCallback(() => {
    if (!sidePanelOpen) {
      return;
    }

    setFileBrowserUiState((current: FileBrowserUiState) => {
      const nextMainCollapsed = !current.mainCollapsed;
      return {
        ...current,
        mainCollapsed: nextMainCollapsed,
        sideCollapsed: nextMainCollapsed ? false : current.sideCollapsed,
      };
    });
  }, [sidePanelOpen]);

  async function handleAddToGrid(items: AddToGridItem[]) {
    for (const item of items) {
      try {
        const sr = item.scanResult;
        const workingDirectory = sr.workingDirectory || "~";
        const connectMode =
          item.connectMode ?? (sr.tmuxSession ? "tmux" : "direct");

        if (connectMode === "tmux" && sr.tmuxSession) {
          await addDiscoveredTmux({
            tmuxSession: sr.tmuxSession,
            tmuxPane: sr.tmuxPane,
            displayName: sr.displayName,
            workingDirectory,
            agentKind: sr.agentKind ?? "shell",
            interactionState: sr.status === "running" ? "running" : "detached",
            outputPreview:
              sr.status === "running"
                ? `${sr.displayName} · 连接中`
                : `${sr.displayName} · detached`,
            sshTarget: sr.sshTarget,
          });
          continue;
        }

        if (sr.sshTarget) {
          await launchSshPtyAgent({
            workspaceId: "default",
            displayName: sr.displayName,
            agentKind: sr.agentKind,
            sshTarget: sr.sshTarget,
            remoteCommand: wrapRemoteInteractiveCommand(
              buildRemoteDirectLaunchCommand(
                sr.agentKind,
                workingDirectory,
                sr.displayName,
                sr.sessionId,
              ),
            ),
            workingDirectory,
            ...(sr.sessionId ? { agentSessionId: sr.sessionId } : {}),
          });
          continue;
        }

        await launchPtyAgent({
          workspaceId: "default",
          displayName: sr.displayName,
          agentKind: sr.agentKind,
          command: buildDirectLaunchCommand(
            sr.agentKind,
            workingDirectory,
            sr.displayName,
            sr.sessionId,
          ),
          workingDirectory,
          ...(sr.sessionId ? { agentSessionId: sr.sessionId } : {}),
        });
      } catch {
        // ignore individual failures
      }
    }
    listAgentSessions()
      .then(setSnapshot)
      .catch(() => {});
  }

  if (isMobileWorkbenchLocation(window.location)) {
    return (
      <MobileWorkbenchPage
        activeSessionId={mobileActiveSessionId}
        isLoading={isLoading}
        sessions={sessions}
        terminalFontSize={terminalFontSize}
        agentCompletionNotificationsEnabled={
          agentCompletionNotificationsEnabled
        }
        agentCompletionNotificationPermission={
          agentCompletionNotificationPermission
        }
        onSwitchSession={handleMobileSwitchSession}
        onTerminalFontSizeChange={handleTerminalFontSizeChange}
        onToggleAgentCompletionNotifications={
          handleToggleAgentCompletionNotifications
        }
      />
    );
  }

  return (
    <main className={`app-shell-v2 layout-${layoutMode}`}>
      <AppUpdateBanner
        state={appUpdateBannerState}
        onApplyUpdate={handleApplyAppUpdate}
        onDismiss={handleDismissAppUpdateBanner}
        onPullUpdate={beginPullAndHotUpdate}
        onRetryUpdate={handleRetryAppUpdate}
      />
      <TopBar
        sessions={sessions}
        collapsed={layoutState.topbarCollapsed}
        sshHosts={sshHosts}
        fileBrowserAvailable={fileBrowserAvailable}
        fileBrowserOpen={fileBrowserOpen}
        vscodeAvailable={vscodeAvailable}
        vscodeOpen={vscodeOpen}
        vscodeIframeCacheMode={vscodeIframeCacheMode}
        vscodeCacheReleaseAvailable={vscodeCacheReleaseAvailable}
        useLightweightTerminalPreview={useLightweightTerminalPreview}
        terminalFontSize={terminalFontSize}
        agentCompletionNotificationsEnabled={
          agentCompletionNotificationsEnabled
        }
        agentCompletionNotificationPermission={
          agentCompletionNotificationPermission
        }
        connectionStatus={connectionStatus}
        onToggleCollapsed={() =>
          updateLayout({ topbarCollapsed: !layoutState.topbarCollapsed })
        }
        onToggleFileBrowser={() => {
          const targetSession = sidePanelTargetSession;
          if (!targetSession) {
            return;
          }

          if (
            openSidePanelTool === "files" &&
            targetSession.id === focusedSession?.id
          ) {
            closeSidePanelTool();
            return;
          }

          if (targetSession.id !== focusedId) {
            setFocusedId(targetSession.id);
          }
          setActiveTerminalSessionId(targetSession.id);
          setOpenSidePanelTool("files");
          ensureSidePanelStateForSession(targetSession);
        }}
        onToggleVsCode={() => {
          const targetSession = sidePanelTargetSession;
          if (!targetSession || !vscodeAvailable) {
            return;
          }

          if (
            openSidePanelTool === "vscode" &&
            targetSession.id === focusedSession?.id
          ) {
            closeSidePanelTool();
            return;
          }

          if (targetSession.id !== focusedId) {
            setFocusedId(targetSession.id);
          }
          setActiveTerminalSessionId(targetSession.id);
          setOpenSidePanelTool("vscode");
          ensureSidePanelStateForSession(targetSession);
        }}
        onToggleVsCodeIframeCacheMode={handleToggleVsCodeIframeCacheMode}
        onReleaseVsCodeIframeCache={handleReleaseVsCodeIframeCache}
        onToggleTerminalPreviewMode={() =>
          setUseLightweightTerminalPreview((current) => !current)
        }
        onTerminalFontSizeChange={handleTerminalFontSizeChange}
        onToggleAgentCompletionNotifications={
          handleToggleAgentCompletionNotifications
        }
        onOpenNewSession={setNewSessionHost}
        onScanTmux={handleScanTmux}
        onScanApps={handleScanApps}
      />

      <div className="main-layout" ref={mainLayoutRef}>
        {sidePanelRendered && focusedSession && focusedSidePanelState && (
          <>
            <div
              className={`file-browser-shell${!sidePanelOpen || sidePanelCollapsed ? " file-browser-shell--collapsed" : ""}${mainPanelCollapsed ? " file-browser-shell--fill" : ""}`}
              ref={fileBrowserShellRef}
              style={
                !sidePanelOpen || sidePanelCollapsed
                  ? undefined
                  : mainPanelCollapsed
                    ? undefined
                    : { width: `${fileBrowserUiState.width}px` }
              }
            >
              <SidePanelView active={fileBrowserOpen}>
                <FileBrowserDrawer
                  key={focusedSession.id}
                  open={fileBrowserOpen}
                  scopeKey={focusedSession.id}
                  defaultPath={
                    focusedSession.sshTarget
                      ? undefined
                      : focusedSession.workingDirectory
                  }
                  selectedHost={focusedSidePanelState.selectedHost}
                  onSelectHost={(host) => {
                    setFileBrowserSessionStates((current) => {
                      const existing =
                        current[focusedSession.id] ?? focusedSidePanelState;
                      if (!existing) {
                        return current;
                      }

                      return {
                        ...current,
                        [focusedSession.id]: {
                          ...existing,
                          selectedHost: host,
                        },
                      };
                    });
                  }}
                  sshHosts={sshHosts}
                />
              </SidePanelView>
              {renderedVsCodeSessionIds.map((sessionId) => {
                const session = sessions.find((item) => item.id === sessionId);
                if (!session) {
                  return null;
                }

                const active = vscodeOpen && focusedSession?.id === sessionId;
                return (
                  <SidePanelView
                    key={sessionId}
                    active={active}
                    preserveMountedWhenInactive
                  >
                    <VSCodeDrawer
                      active={active}
                      agentSessionId={session.id}
                      displayName={session.displayName}
                      open={active}
                    />
                  </SidePanelView>
                );
              })}
            </div>
            {sidePanelOpen && (
              <div
                className="main-layout-splitter"
                data-testid="file-browser-main-splitter"
                onPointerCancel={endFileBrowserResize}
                onPointerDown={beginFileBrowserResize}
                onPointerMove={(event) => {
                  if (
                    fileBrowserResizeRef.current?.pointerId === event.pointerId
                  ) {
                    updateFileBrowserWidth(event.clientX);
                  }
                }}
                onPointerUp={endFileBrowserResize}
                role="separator"
              >
                <button
                  className="main-layout-collapse-btn"
                  data-testid="side-panel-collapse-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSidePanelCollapsed();
                  }}
                  title={sidePanelCollapsed ? "展开左侧分区" : "折叠左侧分区"}
                  type="button"
                >
                  {sidePanelCollapsed ? "⟩" : "⟨"}
                </button>
                <button
                  className="main-layout-collapse-btn"
                  data-testid="main-panel-collapse-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleMainPanelCollapsed();
                  }}
                  title={mainPanelCollapsed ? "展开右侧分区" : "折叠右侧分区"}
                  type="button"
                >
                  {mainPanelCollapsed ? "⟨" : "⟩"}
                </button>
              </div>
            )}
          </>
        )}
        <div
          className={`main-content${mainPanelCollapsed ? " main-content--collapsed" : ""}`}
        >
          {isLoading ? (
            <div className="grid-empty loading-state">
              <div className="loading-spinner" aria-label="加载中"></div>
              <p>正在加载...</p>
            </div>
          ) : viewMode === "focus" && focusedSession ? (
            <AgentFocusView
              focusedSession={focusedSession}
              sessions={sessions}
              onActiveTerminalSessionChange={handleActiveTerminalSessionChange}
              onSwitchFocus={handleSwitchFocus}
              onExit={handleExitFocus}
              onReconnect={handleReconnectSession}
              onDeleteSession={handleDeleteSession}
              onHideSession={handleHideSession}
              onRename={handleRenameSession}
              sessionGroups={sessionGroups}
              onCreateSessionGroup={handleCreateSessionGroup}
              onDeleteSessionGroup={handleDeleteSessionGroup}
              onMoveSessionToGroup={handleMoveSessionToGroup}
              onRenameSessionGroup={handleRenameSessionGroup}
              onToggleSessionGroup={handleToggleSessionGroup}
              useLightweightTerminalPreview={useLightweightTerminalPreview}
              mobileTerminalTouchMode={mobileTerminalTouchMode}
              terminalFontSize={terminalFontSize}
              onTerminalFontSizeChange={handleTerminalFontSizeChange}
            />
          ) : (
            <AgentGrid
              sessions={filteredSessions}
              allSessions={visibleSessions}
              sortMode={agentGridSortMode}
              onSortModeChange={handleAgentGridSortModeChange}
              filters={filters}
              onFiltersChange={setFilters}
              onFocusSession={handleFocusSession}
              onDeleteSession={handleDeleteSession}
              onReconnectSession={handleReconnectSession}
              onRenameSession={handleRenameSession}
              onHideSession={handleHideSession}
              onCopyConnectCommand={handleCopyConnectCommand}
              onKillTmux={handleKillTmux}
              sessionGroups={sessionGroups}
              onCreateSessionGroup={handleCreateSessionGroup}
              onDeleteSessionGroup={handleDeleteSessionGroup}
              onMoveSessionToGroup={handleMoveSessionToGroup}
              onRenameSessionGroup={handleRenameSessionGroup}
              onToggleSessionGroup={handleToggleSessionGroup}
              onNewSession={() => setNewSessionHost({ type: "local" })}
              onScanTmux={() =>
                setDiscoveryState({
                  open: true,
                  mode: "tmux",
                  host: { type: "local" },
                })
              }
              hiddenCount={hiddenSessions.length}
              onShowHidden={() => setShowHiddenDrawer(true)}
              useLightweightTerminalPreview={useLightweightTerminalPreview}
              terminalFontSize={terminalFontSize}
              onTerminalFontSizeChange={handleTerminalFontSizeChange}
            />
          )}
        </div>
      </div>

      <NewSessionDialog
        open={Boolean(newSessionHost)}
        host={newSessionHost}
        sessions={sessions}
        sessionGroups={sessionGroups}
        onClose={() => setNewSessionHost(null)}
        onLaunched={handleLaunched}
      />

      <QuickTmuxConnect
        open={quickTmuxOpen}
        onClose={() => setQuickTmuxOpen(false)}
        onConnected={handleQuickTmuxConnected}
      />

      {discoveryState && (
        <DiscoveryDialog
          open={discoveryState.open}
          mode={discoveryState.mode}
          host={discoveryState.host}
          sessions={sessions}
          onClose={handleDiscoveryClose}
          onAddToGrid={handleAddToGrid}
          onFocusSession={handleFocusSession}
        />
      )}

      <HiddenSessionsDrawer
        sessions={hiddenSessions}
        open={showHiddenDrawer}
        onClose={() => setShowHiddenDrawer(false)}
        onUnhide={handleUnhideSession}
        onDelete={handleDeleteSession}
      />
    </main>
  );
}
