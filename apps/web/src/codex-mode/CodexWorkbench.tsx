import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import { WorkbenchModeSwitch } from "../components/WorkbenchModeSwitch";
import { SessionThemeToggle } from "@session/components/common/SessionThemeToggle";
import { useThemeStore } from "@session/stores/settings/useThemeStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { applyWorkbenchTheme, nativeCodexTheme } from "./workbench-theme";
import type { NativeContentState } from "./native-content";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";
import {
  CodexProjectNavigation,
  type ProjectConversationState,
} from "./CodexProjectNavigation";
import {
  loadProjectConversations,
  loadProjectList,
  type CodexProjectConversation,
} from "./project-conversations";
import {
  persistCodexWindowThread,
  readCodexWindowThreads,
  shouldRestoreCodexWindowThread,
  validateCodexWindowIds,
} from "./codex-window-restore";
import {
  appendCodexNewWindow,
  closeCodexWindow,
  closeEmptyCodexGroup,
  codexSplitGroups,
  focusCodexGroup,
  focusCodexWindow,
  initialCodexWindows,
  openCodexConversation,
  placeCodexWindow,
  replaceCodexWindows,
  readCodexWindows,
  resizeCodexSplit,
  saveCodexWindows,
  type CodexSplitGroup,
  type CodexSplitNode,
  type CodexWindow,
  type CodexWindowState,
} from "./codex-multiwindow-state";
import { codexDropTarget, codexNativeFrames, codexPaneBoxes, type CodexDropTarget } from "./codex-split-geometry";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@session/components/ui/resizable";
import { startCodexTabSync, type CodexTabSyncState } from "./codex-tab-sync";
import "./codex-mode.css";

type NativeStatus = {
  available: boolean;
  resumeAvailable?: boolean;
  sendAvailable?: boolean;
  reason?: string;
  iframeUrl?: string;
  extensionVersion?: string;
  fixtures?: Array<{ id: string; label: string }>;
  newChatWindowIds?: string[];
};

function CodexGroupMenu({ state, onSelect }: { state: CodexWindowState; onSelect: (id: string) => void }) {
  const groups = codexSplitGroups(state.tree);
  return (
    <label className="codex-group-menu">
      窗口组
      <select aria-label="Codex 窗口组" value={state.activeGroupId} onChange={(event) => onSelect(event.target.value)}>
        {groups.map((group, index) => <option key={group.id} value={group.id}>窗口组 {index + 1}（{group.keys.length}）</option>)}
      </select>
    </label>
  );
}

function CodexSplitWorkspace({
  node, windows, activeId, readyWindowIds, composerWindowIds, blockedWindowIds, focusError, preview,
  onSelect, onClose, onCloseEmpty, onResize, onRetry, onTabPointerDown, onTabPointerMove, onTabPointerUp, onTabPointerCancel,
}: {
  node: CodexSplitNode;
  windows: CodexWindow[];
  activeId: string | null;
  readyWindowIds: Set<string>;
  composerWindowIds: Set<string>;
  blockedWindowIds: Set<string>;
  focusError: string | null;
  preview: CodexDropTarget | null;
  onSelect: (id: string) => void;
  onClose: (item: CodexWindow) => void;
  onCloseEmpty: (id: string) => void;
  onResize: (id: string, ratio: number) => void;
  onRetry: (item: CodexWindow) => void;
  onTabPointerDown: (event: ReactPointerEvent<HTMLElement>, key: string) => void;
  onTabPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerCancel: () => void;
}) {
  if (node.type === "group") {
    return <CodexGroupPane group={node} windows={windows} activeId={activeId} readyWindowIds={readyWindowIds}
      composerWindowIds={composerWindowIds} blockedWindowIds={blockedWindowIds} focusError={focusError}
      preview={preview?.groupId === node.id ? preview : null} onSelect={onSelect} onClose={onClose}
      onCloseEmpty={onCloseEmpty} onRetry={onRetry} onTabPointerDown={onTabPointerDown}
      onTabPointerMove={onTabPointerMove} onTabPointerUp={onTabPointerUp} onTabPointerCancel={onTabPointerCancel} />;
  }
  return (
    <ResizablePanelGroup direction={node.direction} id={node.id} onLayout={(sizes) => {
      if (Math.abs(sizes[0] - node.ratio) > 0.1) onResize(node.id, sizes[0]);
    }}>
      <ResizablePanel id={node.first.id} order={0} defaultSize={node.ratio} minSize={15}>
        <CodexSplitWorkspace node={node.first} windows={windows} activeId={activeId} readyWindowIds={readyWindowIds}
          composerWindowIds={composerWindowIds} blockedWindowIds={blockedWindowIds} focusError={focusError} preview={preview}
          onSelect={onSelect} onClose={onClose} onCloseEmpty={onCloseEmpty} onResize={onResize} onRetry={onRetry}
          onTabPointerDown={onTabPointerDown} onTabPointerMove={onTabPointerMove} onTabPointerUp={onTabPointerUp} onTabPointerCancel={onTabPointerCancel} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id={node.second.id} order={1} defaultSize={100 - node.ratio} minSize={15}>
        <CodexSplitWorkspace node={node.second} windows={windows} activeId={activeId} readyWindowIds={readyWindowIds}
          composerWindowIds={composerWindowIds} blockedWindowIds={blockedWindowIds} focusError={focusError} preview={preview}
          onSelect={onSelect} onClose={onClose} onCloseEmpty={onCloseEmpty} onResize={onResize} onRetry={onRetry}
          onTabPointerDown={onTabPointerDown} onTabPointerMove={onTabPointerMove} onTabPointerUp={onTabPointerUp} onTabPointerCancel={onTabPointerCancel} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function CodexGroupPane({
  group, windows, activeId, readyWindowIds, composerWindowIds, blockedWindowIds, focusError, preview,
  onSelect, onClose, onCloseEmpty, onRetry, onTabPointerDown, onTabPointerMove, onTabPointerUp, onTabPointerCancel,
}: {
  group: CodexSplitGroup;
  windows: CodexWindow[];
  activeId: string | null;
  readyWindowIds: Set<string>;
  composerWindowIds: Set<string>;
  blockedWindowIds: Set<string>;
  focusError: string | null;
  preview: CodexDropTarget | null;
  onSelect: (id: string) => void;
  onClose: (item: CodexWindow) => void;
  onCloseEmpty: (id: string) => void;
  onRetry: (item: CodexWindow) => void;
  onTabPointerDown: (event: ReactPointerEvent<HTMLElement>, key: string) => void;
  onTabPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerCancel: () => void;
}) {
  const item = windows.find((window) => window.id === group.selected);
  const shown = Boolean(item && readyWindowIds.has(item.id) && item.state !== "error");
  const needsOfficialGuide = Boolean(shown && item && !composerWindowIds.has(item.id) && !blockedWindowIds.has(item.id));
  return (
    <section className="codex-window-card" data-codex-group={group.id} aria-label={item ? `${item.title} · ${item.cwd}` : "空窗口组"} data-active={item?.id === activeId}>
      <header data-codex-tab-strip>
        {group.keys.map((key) => {
          const tab = windows.find((window) => window.id === key);
          if (!tab) return null;
          return <div className="codex-window-tab" key={key} data-codex-window={key} data-active={key === group.selected}
            onPointerDown={(event) => onTabPointerDown(event, key)} onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp} onPointerCancel={onTabPointerCancel}>
            <button type="button" role="tab" aria-label={tab.title} aria-selected={key === group.selected} onClick={() => onSelect(key)} />
            <strong>{tab.title}</strong><small>{tab.cwd.split("/").filter(Boolean).at(-1)}</small>
            <button type="button" className="codex-window-tab-close" aria-label={`关闭 ${tab.title} 标签`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onClose(tab)}>×</button>
          </div>;
        })}
        {!group.keys.length && <span>空窗口组</span>}
        {group.keepEmpty && !group.keys.length && <button type="button" onClick={() => onCloseEmpty(group.id)}>关闭空窗口组</button>}
      </header>
      <div className="codex-window-body" data-codex-group-body>
        {item && !shown && <div className="codex-window-placeholder" role={item.state === "error" ? "alert" : "status"}>
          {item.state === "error" ? <><strong>这个会话尚未打开</strong><p>{item.error}</p><button type="button" onClick={() => onRetry(item)}>重试打开</button></> : <span>正在加载原生 Codex…</span>}
        </div>}
        {item && shown && blockedWindowIds.has(item.id) && <div className="codex-window-status" role="status">另一实例占用 · 请点原生 Retry</div>}
        {item && shown && activeId !== item.id && <div className="codex-window-activation"><button type="button" onClick={() => onSelect(item.id)}>切换到此窗口</button></div>}
        {item && shown && activeId === item.id && focusError && <div className="codex-window-activation" data-pending="true"><span>{focusError}</span><button type="button" onClick={() => onSelect(item.id)}>重试切换</button></div>}
        {item && needsOfficialGuide && activeId === item.id && !focusError && <div className="codex-window-guide" role="status">请在原生界面中完成官方引导</div>}
        {preview && <div className="codex-split-drop" data-edge={preview.edge}>松开以{preview.edge === "center" ? "移动到此窗口组" : "分屏"}</div>}
      </div>
    </section>
  );
}

const NATIVE_HOST_SESSION_KEY = "kanban.codex.native-host.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function CodexWorkbench({
  active,
  onModeChange,
}: {
  active: boolean;
  onModeChange: (mode: WorkbenchMode) => void;
}) {
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [projectRetry, setProjectRetry] = useState(0);
  const [conversationRetry, setConversationRetry] = useState(0);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(
    () => useWorkspaceStore.getState().cwd,
  );
  const [conversationStates, setConversationStates] = useState<
    Record<string, ProjectConversationState>
  >({});
  const [windowState, setWindowState] = useState<CodexWindowState>(() => initialCodexWindows("native-default", "/"));
  const [mobileLayout, setMobileLayout] = useState(() => window.innerWidth < 768);
  const [dropPreview, setDropPreview] = useState<CodexDropTarget | null>(null);
  const dragRef = useRef<{ key: string; pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const windowStateRef = useRef(windowState);
  const [readyWindowIds, setReadyWindowIds] = useState<Set<string>>(new Set());
  const [composerWindowIds, setComposerWindowIds] = useState<Set<string>>(new Set());
  const [blockedWindowIds, setBlockedWindowIds] = useState<Set<string>>(new Set());
  const readyWindowIdsRef = useRef(new Set<string>());
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const initializedWindowState = useRef(false);
  const [windowStateReady, setWindowStateReady] = useState(false);
  const sharedTabs = useRef<ReturnType<typeof startCodexTabSync> | null>(null);
  const [sharedState, setSharedState] = useState<CodexTabSyncState>({ threads: [], detached: null, pending: [], initialized: false, error: null });
  const pendingOpenThreads = useRef(new Set<string>());
  const [mobilePane, setMobilePane] = useState<"sessions" | "native">(
    "native",
  );
  const [readyPanels, setReadyPanels] = useState(0);
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [hostInstanceId, setHostInstanceId] = useState<string | null>(null);
  const [oldHostInstanceId, setOldHostInstanceId] = useState<string | null>(null);
  const oldHostInstanceIdRef = useRef<string | null>(null);
  const previousHostInstanceIdRef = useRef<string | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [handoffReleasing, setHandoffReleasing] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const hostInstanceIdRef = useRef<string | null>(null);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [newChatNotice, setNewChatNotice] = useState<string | null>(null);
  const [focusRetry, setFocusRetry] = useState(0);
  const focusSequence = useRef(0);
  const focusQueue = useRef<Promise<void>>(Promise.resolve());
  const [restoringPanels, setRestoringPanels] = useState<number[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLElement>(null);
  const surface = useRef<ReturnType<typeof mountNativeSurface> | null>(null);
  const activeRef = useRef(active);
  const projectRequest = useRef(0);
  const projectIndexLoaded = useRef(false);
  const restoreAttempts = useRef(new Set<string>());
  const initializedWindows = useRef(new Set<string>());
  const latestWindowState = useRef(new Map<string, NativeContentState>());
  const restoreTimers = useRef(new Map<string, number>());
  const restoreQueue = useRef<Promise<void>>(Promise.resolve());
  const restorePending = useRef(new Set<number>());
  const restoreFrameLock = useRef<{
    element: HTMLIFrameElement;
    pointerEvents: string;
    tabIndex: number;
  } | null>(null);
  activeRef.current = active;
  windowStateRef.current = windowState;
  const firstWindowId = status?.newChatWindowIds?.[0] ?? "native-default";
  const selectedNativeWindow = windowState.windows.find((item) => item.id === windowState.activeId);
  const selectedNativeTargetId = selectedNativeWindow?.kind === "new"
    ? selectedNativeWindow.id.slice(4) : selectedNativeWindow?.threadId;
  const hostProject = useMemo(() => {
    try {
      const folder = new URL(status?.iframeUrl ?? "", location.origin).searchParams.get("folder");
      return folder?.startsWith("/") ? folder : selectedProject ?? "/";
    } catch {
      return selectedProject ?? "/";
    }
  }, [status?.iframeUrl, selectedProject]);
  useEffect(() => {
    if (!status?.available || initializedWindowState.current) return;
    initializedWindowState.current = true;
    let restored: CodexWindowState;
    try { restored = readCodexWindows(window.localStorage, firstWindowId, hostProject); }
    catch { restored = initialCodexWindows(firstWindowId, hostProject); }
    windowStateRef.current = restored;
    setWindowState(restored);
    setWindowStateReady(true);
  }, [status?.available, firstWindowId, hostProject]);
  useEffect(() => {
    if (!initializedWindowState.current) return;
    try { saveCodexWindows(window.localStorage, windowState, firstWindowId); } catch { /* storage is optional */ }
  }, [windowState, firstWindowId]);
  useEffect(() => {
    if (!windowStateReady) return;
    const seed = windowStateRef.current.windows.flatMap((item) =>
      item.kind === "thread" && item.threadId ? [{ id: item.threadId, cwd: item.cwd, title: item.title }] : []);
    const sync = startCodexTabSync({ seed, onChange: setSharedState });
    sharedTabs.current = sync;
    return () => { sync.stop(); if (sharedTabs.current === sync) sharedTabs.current = null; };
  }, [windowStateReady]);
  useEffect(() => {
    if (!sharedState.initialized) return;
    setWindowState((current) => {
      const localNew = current.windows.filter((item) => item.kind === "new");
      const sharedWindows: CodexWindow[] = sharedState.threads.map((thread) => {
        if (current.windows.some((item) => item.id === thread.id || item.threadId === thread.id))
          restoredThreadIds.current.add(thread.id);
        const existing = current.windows.find((item) => item.id === thread.id || item.threadId === thread.id);
        if (existing && existing.title === thread.title && existing.cwd === thread.cwd) return existing;
        if (existing) return { ...existing, title: thread.title, cwd: thread.cwd };
        return {
          id: thread.id, kind: "thread", threadId: thread.id, title: thread.title, cwd: thread.cwd, state: "opening",
        };
      });
      const sharedIds = new Set(sharedState.threads.map((thread) => thread.id));
      for (const id of sharedIds) seenSharedThreadIds.current.add(id);
      const retained = current.windows.filter((item) => {
        if (item.kind !== "thread" || !item.threadId) return false;
        if (sharedIds.has(item.id) || sharedIds.has(item.threadId)) return false;
        const acknowledged = seenSharedThreadIds.current.has(item.id) || seenSharedThreadIds.current.has(item.threadId);
        return !acknowledged || item.id === current.activeId;
      });
      return replaceCodexWindows(current, [...localNew, ...sharedWindows, ...retained]);
    });
  }, [sharedState]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setCanvasWidth(element.clientWidth || window.innerWidth);
      setCanvasHeight(element.clientHeight || window.innerHeight);
      return;
    }
    const observer = new ResizeObserver(() => {
      setCanvasWidth(element.clientWidth);
      setCanvasHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const paneBoxes = codexPaneBoxes(windowState.tree, {
    width: Math.max(canvasWidth, 1), height: Math.max(canvasHeight, 1),
  }, mobileLayout ? windowState.activeGroupId : undefined);
  const nativeFrames = codexNativeFrames(paneBoxes);
  const layoutRef = useRef({ frames: nativeFrames, interactiveId: null as string | null });
  const interactiveId = windowState.activeId && readyWindowIds.has(windowState.activeId) ? windowState.activeId : null;
  layoutRef.current = { frames: nativeFrames, interactiveId };
  useEffect(() => {
    surface.current?.setLayout?.(layoutRef.current);
  }, [windowState, canvasWidth, canvasHeight, interactiveId, mobileLayout]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileLayout(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const sequence = ++focusSequence.current;
    setFocusedWindowId(null);
    setFocusError(null);
    if (!active || !hostInstanceId || !selectedNativeWindow || !selectedNativeTargetId || !readyWindowIds.has(selectedNativeWindow.id)) return;
    const target = { instanceId: hostInstanceId, kind: selectedNativeWindow.kind, targetId: selectedNativeTargetId };
    const activate = async () => {
      if (sequence !== focusSequence.current) return;
      try {
        const response = await fetch("/api/native-codex/focus", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(target), cache: "no-store",
        });
        if (!response.ok) throw new Error(`原生窗口切换失败（HTTP ${response.status}）`);
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || (result as { focused?: unknown }).focused !== true)
          throw new Error("原生 Codex 没有确认输入窗口");
        if (sequence === focusSequence.current) setFocusedWindowId(selectedNativeWindow.id);
      } catch (cause) {
        if (sequence === focusSequence.current)
          setFocusError(cause instanceof Error ? cause.message : "原生窗口切换失败");
      }
    };
    focusQueue.current = focusQueue.current.then(activate, activate);
  }, [active, hostInstanceId, oldHostInstanceId, selectedNativeWindow?.id, selectedNativeWindow?.kind, selectedNativeTargetId, readyWindowIds, focusRetry]);
  const restoredThreadIds = useRef(new Set<string>());
  const restoredNewWindowIds = useRef(new Set<string>());
  useEffect(() => {
    if (!active || !hostInstanceId || !initializedWindowState.current) return;
    for (const item of windowState.windows) {
      if (item.kind === "thread" && item.state !== "error" && !restoredThreadIds.current.has(item.id) && !pendingOpenThreads.current.has(item.id)) {
        void requestOpenThread(item.id);
      } else if (item.kind === "new" && item.id !== `new:${firstWindowId}` && !restoredNewWindowIds.current.has(item.id)) {
        restoredNewWindowIds.current.add(item.id);
        void requestOpenNewWindow(item.id);
      }
    }
  }, [active, hostInstanceId, oldHostInstanceId, windowState.windows, firstWindowId]);
  useEffect(() => {
    if (!active || !hostInstanceId || !blockedWindowIds.size) {
      oldHostInstanceIdRef.current = null;
      setOldHostInstanceId(null);
      return;
    }
    const previous = previousHostInstanceIdRef.current;
    if (!previous || previous === hostInstanceId) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/native-codex/instance-status", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ instanceId: previous }), signal: abort.signal, cache: "no-store",
        });
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (abort.signal.aborted || !value || typeof value !== "object" || (value as { active?: unknown }).active !== true) return;
        oldHostInstanceIdRef.current = previous;
        setOldHostInstanceId(previous);
        try { window.sessionStorage.setItem(NATIVE_HOST_SESSION_KEY, JSON.stringify({ hostKey: firstWindowId, instanceId: hostInstanceId, previousInstanceId: previous })); } catch { /* Optional storage. */ }
      } catch { /* Unknown liveness must not offer a destructive handoff. */ }
    })();
    return () => abort.abort();
  }, [active, hostInstanceId, blockedWindowIds, firstWindowId]);
  useEffect(() => {
    if (!active || status) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/native-codex/status", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Codex 服务暂时不可用");
        const value: unknown = await response.json();
        if (abort.signal.aborted) return;
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as NativeStatus).available !== "boolean"
        )
          throw new Error("Codex 服务返回了无效状态");
        const received = value as NativeStatus;
        const next: NativeStatus = {
          ...received,
          newChatWindowIds: validateCodexWindowIds(received.newChatWindowIds),
        };
        const nextUrl = next.available
          ? nativeIframeUrl(next.iframeUrl, location.origin)
          : null;
        if (next.available && !nextUrl) throw new Error("Codex 界面地址不可用");
        if (nextUrl) setHostUrl((current) => current ?? nextUrl);
        setStatus(next);
        setError(null);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Codex 连接失败");
      }
    })();
    return () => abort.abort();
  }, [active, status, retry]);
  useEffect(() => {
    if (!active || !status?.available || status.resumeAvailable === true)
      return;
    const controller = new AbortController();
    let timer: number | null = null;
    let attempts = 0;
    const checkCompanion = async () => {
      try {
        const response = await fetch("/api/native-codex/status", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Codex 状态暂不可用");
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as NativeStatus).available !== "boolean" ||
          typeof (value as NativeStatus).resumeAvailable !== "boolean"
        )
          throw new Error("Codex 状态返回了无效数据");
        const received = value as NativeStatus;
        if (controller.signal.aborted) return;
        if (!received.available) {
          setStatus(received);
          return;
        }
        if (received.resumeAvailable === true) {
          setStatus((current) =>
            current ? { ...current, ...received } : received,
          );
          setConnectionError(null);
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      attempts += 1;
      if (attempts >= 120) {
        setConnectionError("原生 Codex 窗口未能就绪，请重试连接");
        return;
      }
      timer = window.setTimeout(() => void checkCompanion(), 500);
    };
    timer = window.setTimeout(() => void checkCompanion(), 500);
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, status?.available, status?.resumeAvailable]);
  useEffect(() => {
    if (!active) {
      projectIndexLoaded.current = false;
      return;
    }
    if ((!status && !error) || projectIndexLoaded.current) return;
    projectIndexLoaded.current = true;
    const controller = new AbortController();
    const requestId = ++projectRequest.current;
    setProjectsLoading(true);
    setProjectsError(null);
    void loadProjectList(fetch, controller.signal)
      .then((nextProjects) => {
        if (controller.signal.aborted || requestId !== projectRequest.current)
          return;
        setProjects(nextProjects);
        setSelectedProject((current) =>
          current && nextProjects.includes(current)
            ? current
            : (nextProjects[0] ?? null),
        );
      })
      .catch((cause) => {
        if (controller.signal.aborted || requestId !== projectRequest.current)
          return;
        setProjectsError(
          cause instanceof Error ? cause.message : "项目列表读取失败",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId === projectRequest.current)
          setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [active, status, error, projectRetry]);
  useEffect(() => {
    if (!active || !selectedProject || !projects.includes(selectedProject))
      return;
    const controller = new AbortController();
    setConversationStates((previous) => ({
      ...previous,
      [selectedProject]: {
        loading: true,
        error: null,
        conversations: previous[selectedProject]?.conversations ?? [],
      },
    }));
    void loadProjectConversations(selectedProject, undefined, controller.signal)
      .then((conversations) => {
        if (controller.signal.aborted) return;
        setConversationStates((previous) => ({
          ...previous,
          [selectedProject]: { loading: false, error: null, conversations },
        }));
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setConversationStates((previous) => ({
          ...previous,
          [selectedProject]: {
            loading: false,
            error: cause instanceof Error ? cause.message : "会话读取失败",
            conversations: previous[selectedProject]?.conversations ?? [],
          },
        }));
      });
    return () => controller.abort();
  }, [active, selectedProject, projects, conversationRetry]);
  useEffect(() => {
    if (active) surface.current?.start();
    else surface.current?.pause();
  }, [active]);
  useEffect(() => {
    if (active) return;
    for (const timer of restoreTimers.current.values())
      window.clearTimeout(timer);
    restoreTimers.current.clear();
  }, [active]);
  useEffect(
    () => () => {
      for (const timer of restoreTimers.current.values())
        window.clearTimeout(timer);
      restoreTimers.current.clear();
      const locked = restoreFrameLock.current;
      if (locked?.element.isConnected) {
        locked.element.style.pointerEvents = locked.pointerEvents;
        locked.element.tabIndex = locked.tabIndex;
      }
      restoreFrameLock.current = null;
      surface.current?.dispose();
      surface.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!active || !status?.available || readyPanels > 0)
      return;
    const timer = window.setTimeout(
      () => setLoadError("原生 Codex 界面未能加载，请重试连接"),
      60_000,
    );
    return () => window.clearTimeout(timer);
  }, [active, status, readyPanels]);
  const url = hostUrl;
  const retryConnection = () => {
    // Re-arm bounded content observation without replacing any native iframe.
    surface.current?.pause();
    if (activeRef.current) surface.current?.start();
    setStatus(null);
    setError(null);
    setLoadError(null);
    setConnectionError(null);
    setRetry((value) => value + 1);
  };
  const selectProject = (project: string) => {
    setSelectedProject(project);
    setMobilePane("sessions");
  };
  const retryProjects = () => {
    projectIndexLoaded.current = false;
    setProjectRetry((value) => value + 1);
  };
  const retryConversations = (project = selectedProject) => {
    if (project) setSelectedProject(project);
    setConversationRetry((value) => value + 1);
  };
  const requestOpenThread = async (threadId: string) => {
    if (!status?.available || !hostInstanceId || pendingOpenThreads.current.has(threadId)) return;
    pendingOpenThreads.current.add(threadId);
    restoredThreadIds.current.add(threadId);
    setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
      item.id === threadId ? { ...item, state: "opening", error: undefined } : item,
    ) }));
    try {
      const response = await fetch("/api/native-codex/resume-beside", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, instanceId: hostInstanceId }),
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(`Codex 窗口打开失败（HTTP ${response.status}）`);
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        (result as { opened?: unknown }).opened !== true
      )
        throw new Error("Codex 窗口没有确认打开所选会话");
      const column = (result as { column?: unknown }).column;
      if (Number.isInteger(column) && (column as number) >= 1)
        surface.current?.bindWindowAtColumn?.(threadId, column as number);
      setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
        item.id === threadId ? { ...item, state: "ready", error: undefined } : item,
      ) }));
      window.setTimeout(() => {
        if (readyWindowIdsRef.current.has(threadId)) return;
        setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
          item.id === threadId && item.state !== "error"
            ? { ...item, state: "error", error: "原生 Codex 未显示这个会话，请重试打开" }
            : item,
        ) }));
      }, 60_000);
    } catch (cause) {
      const observed = latestWindowState.current.get(threadId);
      if (observed?.ready && observed.hasComposer && observed.conversationId === threadId) {
        setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
          item.id === threadId ? { ...item, state: "ready", error: undefined } : item,
        ) }));
        return;
      }
      setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
        item.id === threadId ? { ...item, state: "error", error: cause instanceof Error ? cause.message : "Codex 会话打开失败" } : item,
      ) }));
    } finally {
      pendingOpenThreads.current.delete(threadId);
    }
  };
  const resumeConversation = (conversation: CodexProjectConversation) => {
    const existing = windowState.windows.find((item) => item.id === conversation.id || item.threadId === conversation.id);
    setWindowState((current) => openCodexConversation(current, conversation));
    sharedTabs.current?.queue({ type: "add", thread: {
      id: conversation.id, cwd: conversation.cwd,
      title: (conversation.name?.trim() || conversation.preview.trim() || "未命名会话").slice(0, 160),
    } });
    setSelectedProject(conversation.cwd);
    setMobilePane("native");
    setFocusRetry((value) => value + 1);
    if (!existing || existing.state === "error") {
      restoredThreadIds.current.add(conversation.id);
      void requestOpenThread(conversation.id);
    }
  };
  const requestOpenNewWindow = async (id: string) => {
    if (!status?.available || !hostInstanceId || !id.startsWith("new:")) return;
    setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
      item.id === id ? { ...item, state: "opening", error: undefined } : item,
    ) }));
    try {
      const response = await fetch("/api/native-codex/new-beside", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowId: id.slice(4), instanceId: hostInstanceId }), cache: "no-store",
      });
      if (!response.ok) throw new Error(`Codex 新聊天打开失败（HTTP ${response.status}）`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || (result as { opened?: unknown }).opened !== true)
        throw new Error("原生 Codex 没有确认新聊天窗口");
      const column = (result as { column?: unknown }).column;
      if (Number.isInteger(column) && (column as number) >= 1)
        surface.current?.bindWindowAtColumn?.(id, column as number);
      setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
        item.id === id ? { ...item, state: "ready", error: undefined } : item,
      ) }));
      window.setTimeout(() => {
        if (readyWindowIdsRef.current.has(id)) return;
        setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
          item.id === id && item.state !== "error" ? { ...item, state: "error", error: "原生 Codex 未显示这个新聊天，请重试打开" } : item,
        ) }));
      }, 60_000);
    } catch (cause) {
      setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
        item.id === id ? { ...item, state: "error", error: cause instanceof Error ? cause.message : "Codex 新聊天打开失败" } : item,
      ) }));
    }
  };
  const addNewChat = (project = hostProject) => {
    if (!status?.available || !hostInstanceId) return;
    if (project) setSelectedProject(project);
    for (const item of windowState.windows) {
      if (item.kind !== "new" || item.threadId) continue;
      const native = surface.current?.getWindowState?.(item.id) ?? latestWindowState.current.get(item.id);
      if (native?.hasComposer && !native.composerEmpty) {
        setNewChatNotice("请先发送当前新聊天草稿，再打开另一个新聊天；官方插件会把未发送内容带入新窗口。");
        return;
      }
      if (!native?.ready || !native.hasComposer) {
        setNewChatNotice("请等待现有新聊天输入框加载完成，再打开下一个窗口。");
        return;
      }
    }
    setNewChatNotice(null);
    const windowId = crypto.randomUUID();
    const id = `new:${windowId}`;
    setWindowState((current) => appendCodexNewWindow(current, windowId, project || hostProject));
    restoredNewWindowIds.current.add(id);
    setMobilePane("native");
    void requestOpenNewWindow(id);
  };
  const selectWindow = (id: string) => {
    setWindowState((current) => focusCodexWindow(current, id));
    setFocusRetry((value) => value + 1);
  };
  const closeWindow = (item: CodexWindow) => {
    if (item.kind === "thread" && item.threadId) sharedTabs.current?.queue({ type: "remove", id: item.threadId });
    setWindowState((current) => closeCodexWindow(current, item.id));
  };
  const beginTabDrag = (event: ReactPointerEvent<HTMLElement>, key: string) => {
    if (event.button !== 0 || mobileLayout) return;
    dragRef.current = { key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveTabDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.dragging = true;
    const root = canvas.current;
    setDropPreview(root ? codexDropTarget(root, event.clientX, event.clientY) : null);
  };
  const finishTabDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropPreview(null);
    if (!drag || !drag.dragging) return;
    const root = canvas.current;
    const target = root ? codexDropTarget(root, event.clientX, event.clientY) : null;
    if (!target || target.beforeKey === drag.key) return;
    setWindowState((current) => placeCodexWindow(current, drag.key, target.groupId, target.edge, target.beforeKey));
    setFocusRetry((value) => value + 1);
  };
  const cancelTabDrag = () => {
    dragRef.current = null;
    setDropPreview(null);
  };
  const lockFrameForRestore = () => {
    const element = frame.current;
    if (!element || restoreFrameLock.current) return;
    restoreFrameLock.current = {
      element,
      pointerEvents: element.style.pointerEvents,
      tabIndex: element.tabIndex,
    };
    element.style.pointerEvents = "none";
    element.tabIndex = -1;
    try {
      (element.contentDocument?.activeElement as HTMLElement | null)?.blur();
    } catch {
      /* The same-origin host may be navigating while restoration is queued. */
    }
  };
  const unlockFrameAfterRestore = () => {
    const previous = restoreFrameLock.current;
    if (!previous) return;
    if (previous.element.isConnected) {
      previous.element.style.pointerEvents = previous.pointerEvents;
      previous.element.tabIndex = previous.tabIndex;
    }
    restoreFrameLock.current = null;
  };
  const enqueueRestore = (
    panelIndex: number,
    windowId: string,
    threadId: string,
  ) => {
    if (oldHostInstanceIdRef.current) return;
    const key = `${windowId}:${threadId}`;
    if (restoreAttempts.current.has(key)) return;
    restoreAttempts.current.add(key);
    restorePending.current.add(panelIndex);
    setRestoringPanels(Array.from(restorePending.current).sort());
    lockFrameForRestore();
    const restore = async () => {
      try {
        const deadline = Date.now() + 10_000;
        while (!hostInstanceIdRef.current && activeRef.current && Date.now() < deadline)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        const instanceId = hostInstanceIdRef.current;
        if (!instanceId || !activeRef.current || oldHostInstanceIdRef.current) return;
        await fetch("/api/native-codex/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ windowId, threadId, column: panelIndex + 1, instanceId }),
          cache: "no-store",
        });
      } catch {
        /* The original blank editor remains available when restoration cannot reach the host. */
      } finally {
        restorePending.current.delete(panelIndex);
        setRestoringPanels(Array.from(restorePending.current).sort());
        if (restorePending.current.size === 0) unlockFrameAfterRestore();
      }
    };
    restoreQueue.current = restoreQueue.current.then(restore, restore);
  };
  const finishHandoff = (instanceId: string) => {
    try { window.sessionStorage.setItem(NATIVE_HOST_SESSION_KEY, JSON.stringify({ hostKey: firstWindowId, instanceId })); }
    catch { /* Browser storage is optional. */ }
    oldHostInstanceIdRef.current = null;
    previousHostInstanceIdRef.current = null;
    setOldHostInstanceId(null);
    setHandoffError(null);
    const windowIds = status?.newChatWindowIds;
    if (!windowIds) return;
    for (const [panelIndex, windowId] of windowIds.entries()) {
      const state = latestWindowState.current.get(windowId);
      if (!state) continue;
      let savedThreadId: string | undefined;
      try { savedThreadId = readCodexWindowThreads(window.localStorage, windowIds).get(windowId); }
      catch { continue; }
      if (shouldRestoreCodexWindowThread({ windowId, windowIds, savedThreadId,
        currentThreadId: state.conversationId, hasComposer: state.hasComposer,
        composerEmpty: state.composerEmpty, userInteracted: state.userInteracted }))
        enqueueRestore(panelIndex, windowId, savedThreadId!);
    }
  };
  const releasePreviousHost = async () => {
    if (!oldHostInstanceId || !hostInstanceId || handoffReleasing) return;
    setHandoffReleasing(true);
    setHandoffError(null);
    try {
      const response = await fetch("/api/native-codex/release-instance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldInstanceId: oldHostInstanceId, currentInstanceId: hostInstanceId }), cache: "no-store",
      });
      if (!response.ok) throw new Error(`旧 Codex 实例释放失败（HTTP ${response.status}）`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || (result as { released?: unknown }).released !== true)
        throw new Error("旧 Codex 实例没有确认释放");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      finishHandoff(hostInstanceId);
      setHandoffNotice("旧实例已释放，请在被占用的原生会话中点击 Retry 恢复。其它窗口可继续使用。");
    } catch (cause) {
      setHandoffError(cause instanceof Error ? cause.message : "旧 Codex 实例释放失败");
    } finally { setHandoffReleasing(false); }
  };
  const theme = useThemeStore((state) => state.theme);
  const systemDark = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => true,
  );
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const appliedTheme = useRef<string | null>(null);
  useEffect(() => {
    applyWorkbenchTheme(document, resolvedTheme);
    if (!active || !hostInstanceId || appliedTheme.current === resolvedTheme) return;
    appliedTheme.current = resolvedTheme;
    const requested = nativeCodexTheme(resolvedTheme);
    void fetch("/api/native-codex/theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId: hostInstanceId, theme: requested.theme }),
      cache: "no-store",
    }).catch(() => {
      appliedTheme.current = null;
    });
  }, [active, hostInstanceId, resolvedTheme]);
  return (
    <section className="codex-workbench" aria-label="Codex 工作台">
      <header className="codex-mode-header">
        <div className="codex-mode-brand">
          <img src="/houmo-logo.png" alt="Houmo" />
          <span>Coding Kanban</span>
        </div>
        <WorkbenchModeSwitch mode="codex" onChange={onModeChange} />
        <span className="codex-mode-native-label">原生 Codex</span>
        {status?.extensionVersion && (
          <span className="codex-mode-version">{status.extensionVersion}</span>
        )}
        <SessionThemeToggle />
      </header>
      <div className="codex-workbench-main" data-mobile-pane={mobilePane}>
        <CodexProjectNavigation
          projects={projects}
          projectsLoading={projectsLoading}
          projectsError={projectsError}
          selectedProject={selectedProject}
          conversationStates={conversationStates}
          canResume={Boolean(status?.available && hostInstanceId)}
          openingThreadIds={windowState.windows.filter((item) => item.state === "opening").map((item) => item.threadId!).filter(Boolean)}
          openThreadIds={windowState.windows.map((item) => item.threadId).filter((item): item is string => Boolean(item))}
          mobilePane={mobilePane}
          onDismiss={() => setMobilePane("native")}
          onSelectProject={selectProject}
          onRetryProjects={retryProjects}
          onRetryConversations={retryConversations}
          onOpenConversation={(conversation) =>
            void resumeConversation(conversation)
          }
          onNewChat={addNewChat}
          onEnsureProject={(project) => {
            if (conversationStates[project]) return;
            setConversationStates((previous) => ({
              ...previous,
              [project]: { loading: true, error: null, conversations: [] },
            }));
            void loadProjectConversations(project)
              .then((conversations) => setConversationStates((previous) => ({
                ...previous,
                [project]: { loading: false, error: null, conversations },
              })))
              .catch((cause) => setConversationStates((previous) => ({
                ...previous,
                [project]: {
                  loading: false,
                  error: cause instanceof Error ? cause.message : "会话读取失败",
                  conversations: [],
                },
              })));
          }}
        />
        <div className="codex-native-workspace">
          <div className="codex-mode-toolbar">
            <button type="button" className="codex-mobile-session-back" onClick={() => setMobilePane("sessions")}>项目会话</button>
            {mobileLayout && <CodexGroupMenu state={windowState} onSelect={(id) => setWindowState((current) => focusCodexGroup(current, id))} />}
            <span className="codex-window-count">{windowState.windows.length} 个窗口</span>
            {sharedState.initialized && selectedNativeWindow?.kind === "thread" && selectedNativeWindow.threadId &&
              !sharedState.threads.some((thread) => thread.id === selectedNativeWindow.threadId) &&
              <span className="codex-unfollowed" role="status">当前会话未关注</span>}
            {sharedState.error && <span className="codex-resume-error" role="status">{sharedState.error}</span>}
            <button type="button" className="codex-new-chat" onClick={addNewChat} disabled={!hostInstanceId}>+ 新聊天</button>
            {newChatNotice && <span className="codex-resume-error" role="alert">{newChatNotice}</span>}
            {status?.available && !hostInstanceId && (
              <span role="status">正在连接原生 Codex 窗口…</span>
            )}
            {restoringPanels.length > 0 && (
              <span role="status">
                正在恢复 Codex 窗口（
                {restoringPanels.map((index) => index + 1).join("、")}）
              </span>
            )}
            {connectionError && (
              <span className="codex-resume-error" role="alert">
                {connectionError}
              </span>
            )}
            <button type="button" className="codex-connection-retry" onClick={retryConnection}>重试连接</button>
          </div>
          {oldHostInstanceId && <div className="codex-handoff-banner" role="alert">
            <div><strong>会话仍被旧 Codex 实例占用</strong><p>原生会话报告了占用，刷新前的实例仍在运行。释放它会结束该实例中正在运行的任务；其它窗口可以继续使用。</p>
              {handoffError && <p className="codex-resume-error">{handoffError}</p>}</div>
            <button type="button" onClick={() => void releasePreviousHost()} disabled={handoffReleasing}>{handoffReleasing ? "正在释放…" : "释放旧实例并恢复"}</button>
            <button type="button" onClick={() => hostInstanceId && finishHandoff(hostInstanceId)} disabled={handoffReleasing}>保留旧实例，继续打开</button>
          </div>}
          {handoffNotice && blockedWindowIds.size > 0 && <div className="codex-handoff-banner" role="status">{handoffNotice}</div>}
          <main className="codex-mode-canvas" ref={canvas}>
            <div className="codex-window-stage">
            {url && (
              <iframe
                key={url}
                ref={frame}
                title="原生 Codex 会话窗口"
                src={url}
                allow="clipboard-read; clipboard-write; fullscreen"
                tabIndex={active ? 0 : -1}
                className="codex-mode-frame"
                style={{ opacity: readyPanels ? 1 : 0 }}
                onLoad={() => {
                  surface.current?.dispose();
                  surface.current = null;
                  focusSequence.current += 1;
                  setFocusedWindowId(null);
                  setFocusError(null);
                  hostInstanceIdRef.current = null;
                  setHostInstanceId(null);
                  readyWindowIdsRef.current.clear();
                  setReadyWindowIds(new Set());
                  setComposerWindowIds(new Set());
                  setBlockedWindowIds(new Set());
                  restoredThreadIds.current.clear();
                  restoredNewWindowIds.current.clear();
                  try {
                    const document = frame.current?.contentDocument;
                    if (!document)
                      throw new Error("原生 Codex 界面暂时无法连接");
                    const next = mountNativeSurface(
                      document,
                      () => {},
                      (count) => {
                        setReadyPanels(count);
                        if (count > 0) setLoadError(null);
                      },
                      {
                        windowIds: status?.newChatWindowIds,
                        onHostInstance: (instanceId) => {
                          if (!UUID.test(instanceId) || hostInstanceIdRef.current === instanceId) return;
                          try {
                            const saved: unknown = JSON.parse(window.sessionStorage.getItem(NATIVE_HOST_SESSION_KEY) ?? "null");
                            const previous = saved && typeof saved === "object" && (saved as { hostKey?: unknown }).hostKey === firstWindowId
                              ? (saved as { instanceId?: unknown }).instanceId : null;
                            const pending = saved && typeof saved === "object" && (saved as { hostKey?: unknown }).hostKey === firstWindowId
                              ? (saved as { previousInstanceId?: unknown }).previousInstanceId : null;
                            previousHostInstanceIdRef.current = typeof pending === "string" && UUID.test(pending) && pending !== instanceId ? pending
                              : typeof previous === "string" && UUID.test(previous) && previous !== instanceId ? previous : null;
                            oldHostInstanceIdRef.current = null;
                            setOldHostInstanceId(null);
                            window.sessionStorage.setItem(NATIVE_HOST_SESSION_KEY, JSON.stringify({ hostKey: firstWindowId, instanceId }));
                          } catch { oldHostInstanceIdRef.current = null; setOldHostInstanceId(null); }
                          hostInstanceIdRef.current = instanceId;
                          setHostInstanceId(instanceId);
                        },
                        onWindowState: (windowId, state) => {
                          latestWindowState.current.set(windowId, state);
                          setBlockedWindowIds((current) => {
                            const blocked = state.blockedByOtherApp === true;
                            if (current.has(windowId) === blocked) return current;
                            const next = new Set(current);
                            if (blocked) next.add(windowId); else next.delete(windowId);
                            return next;
                          });
                          setComposerWindowIds((current) => {
                            const nextReady = state.ready && state.hasComposer;
                            if (current.has(windowId) === nextReady) return current;
                            const next = new Set(current);
                            if (nextReady) next.add(windowId); else next.delete(windowId);
                            return next;
                          });
                          if (!state.ready) {
                            if (readyWindowIdsRef.current.delete(windowId))
                              setReadyWindowIds(new Set(readyWindowIdsRef.current));
                            return;
                          }
                          if (!readyWindowIdsRef.current.has(windowId)) {
                            readyWindowIdsRef.current.add(windowId);
                            setReadyWindowIds(new Set(readyWindowIdsRef.current));
                          }
                          setWindowState((current) => {
                            const item = current.windows.find((row) => row.id === windowId);
                            if (!item || (item.state === "ready" && (!state.conversationId || item.threadId === state.conversationId))) return current;
                            return { ...current, windows: current.windows.map((row) => row.id === windowId
                              ? { ...row, state: "ready", error: undefined, ...(row.kind === "new" && state.conversationId ? { threadId: state.conversationId } : {}) }
                              : row) };
                          });
                        },
                        onThreadState: (panelIndex, state) => {
                          const windowIds = status?.newChatWindowIds;
                          const windowId = windowIds?.[panelIndex];
                          if (!windowId) return;
                          if (initializedWindowState.current &&
                            !windowStateRef.current.windows.some((item) => item.id === `new:${windowId}`)) return;
                          latestWindowState.current.set(windowId, state);
                          const pendingTimer =
                            restoreTimers.current.get(windowId);
                          if (pendingTimer !== undefined) {
                            window.clearTimeout(pendingTimer);
                            restoreTimers.current.delete(windowId);
                          }
                          if (!state.ready || !state.hasComposer || oldHostInstanceIdRef.current) return;
                          let storage: Storage;
                          try {
                            storage = window.localStorage;
                          } catch {
                            return;
                          }
                          if (state.conversationId) {
                            const conversationId = state.conversationId;
                            const source = windowStateRef.current.windows.find((item) => item.id === `new:${windowId}`);
                            if (source && source.threadId !== conversationId) sharedTabs.current?.queue({
                              type: "add", thread: { id: conversationId, cwd: source.cwd, title: source.title },
                            });
                            setWindowState((current) => ({ ...current, windows: current.windows.map((item) =>
                              item.id === `new:${windowId}` && item.threadId !== conversationId
                                ? { ...item, threadId: conversationId } : item,
                            ) }));
                            initializedWindows.current.add(windowId);
                            persistCodexWindowThread(
                              storage,
                              windowIds,
                              windowId,
                              state.conversationId,
                            );
                            return;
                          }
                          if (initializedWindows.current.has(windowId)) return;
                          initializedWindows.current.add(windowId);
                          const savedThreadId = readCodexWindowThreads(
                            storage,
                            windowIds,
                          ).get(windowId);
                          if (
                            !shouldRestoreCodexWindowThread({
                              windowId,
                              windowIds,
                              savedThreadId,
                              currentThreadId: state.conversationId,
                              hasComposer: state.hasComposer,
                              composerEmpty: state.composerEmpty,
                              userInteracted: state.userInteracted,
                            })
                          )
                            return;
                          const timer = window.setTimeout(() => {
                            restoreTimers.current.delete(windowId);
                            if (!activeRef.current) return;
                            const current =
                              latestWindowState.current.get(windowId);
                            let currentStorage: Storage;
                            try {
                              currentStorage = window.localStorage;
                            } catch {
                              return;
                            }
                            const currentThreadId = readCodexWindowThreads(
                              currentStorage,
                              windowIds,
                            ).get(windowId);
                            if (
                              !current ||
                              !shouldRestoreCodexWindowThread({
                                windowId,
                                windowIds,
                                savedThreadId: currentThreadId,
                                currentThreadId: current.conversationId,
                                hasComposer: current.hasComposer,
                                composerEmpty: current.composerEmpty,
                                userInteracted: current.userInteracted,
                              })
                            )
                              return;
                            enqueueRestore(
                              panelIndex,
                              windowId,
                              currentThreadId!,
                            );
                          }, 800);
                          restoreTimers.current.set(windowId, timer);
                        },
                      },
                    );
                    surface.current = next;
                    if (activeRef.current) next.start();
                    next.setLayout?.(layoutRef.current);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "原生 Codex 界面无法访问",
                    );
                  }
                }}
              />
            )}
            <CodexSplitWorkspace
              node={mobileLayout ? codexSplitGroups(windowState.tree).find((group) => group.id === windowState.activeGroupId) ?? windowState.tree : windowState.tree}
              windows={windowState.windows}
              activeId={windowState.activeId}
              readyWindowIds={readyWindowIds}
              composerWindowIds={composerWindowIds}
              blockedWindowIds={blockedWindowIds}
              focusError={focusError}
              preview={dropPreview}
              onSelect={selectWindow}
              onClose={closeWindow}
              onCloseEmpty={(id) => setWindowState((current) => closeEmptyCodexGroup(current, id))}
              onResize={(id, ratio) => setWindowState((current) => resizeCodexSplit(current, id, ratio))}
              onRetry={(item) => item.kind === "thread" && item.threadId ? void requestOpenThread(item.threadId) : void requestOpenNewWindow(item.id)}
              onTabPointerDown={beginTabDrag}
              onTabPointerMove={moveTabDrag}
              onTabPointerUp={finishTabDrag}
              onTabPointerCancel={cancelTabDrag}
            />
            {windowState.windows.length === 0 && <div className="codex-window-empty">从左侧选择会话，或打开新聊天。</div>}
            {(!status ||
              !status.available ||
              !readyPanels ||
              error ||
              loadError) && (
              <div
                className="codex-mode-state"
                role={
                  error || loadError || status?.available === false
                    ? "alert"
                    : "status"
                }
              >
                <h1>
                  {error ||
                    loadError ||
                    (status?.available === false
                      ? status.reason || "Codex 服务尚未准备好"
                      : "正在加载原生 Codex…")}
                </h1>
                {status?.available === false && (
                  <p>会话和终端模式仍可继续使用。</p>
                )}
              </div>
            )}
            </div>
          </main>
        </div>
      </div>
    </section>
  );
}
