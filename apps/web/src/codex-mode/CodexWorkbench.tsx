import { useEffect, useRef, useState } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import { WorkbenchModeSwitch } from "../components/WorkbenchModeSwitch";
import { navigateToAgentSession } from "@session/lib/agentNav";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useNativeCodexTargetStore } from "./native-codex-target";
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
  const [selectedColumn, setSelectedColumn] = useState(1);
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"sessions" | "native">(
    "sessions",
  );
  const [panels, setPanels] = useState(0);
  const [readyPanels, setReadyPanels] = useState(0);
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [restoringPanels, setRestoringPanels] = useState<number[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
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
          setResumeError(null);
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      attempts += 1;
      if (attempts >= 120) {
        setResumeError("原生 Codex 窗口未能就绪，请重试连接");
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
    if (!active || !status?.available || panels === 0 || readyPanels === panels)
      return;
    const timer = window.setTimeout(
      () => setLoadError("原生 Codex 界面未能加载，请重试连接"),
      60_000,
    );
    return () => window.clearTimeout(timer);
  }, [active, status, panels, readyPanels]);
  const url = hostUrl;
  const retryConnection = () => {
    setStatus(null);
    setError(null);
    setLoadError(null);
    setResumeError(null);
    setRetry((value) => value + 1);
  };
  const selectProject = (project: string) => {
    setSelectedProject(project);
    useWorkspaceStore.getState().setCwd(project);
    setMobilePane("sessions");
  };
  const retryProjects = () => {
    projectIndexLoaded.current = false;
    setProjectRetry((value) => value + 1);
  };
  const retryConversations = () => setConversationRetry((value) => value + 1);
  const resumeConversation = async (conversation: CodexProjectConversation) => {
    if (
      !status?.available ||
      status.resumeAvailable !== true ||
      openingThreadId
    )
      return;
    setOpeningThreadId(conversation.id);
    setResumeError(null);
    try {
      const response = await fetch("/api/native-codex/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: conversation.id,
          column: selectedColumn,
        }),
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
      const selected = navigateToAgentSession({
        agent: "codex",
        cwd: conversation.cwd,
        threadId: conversation.id,
      });
      if (!selected) throw new Error("无法将输入目标切换到所选 Codex 会话");
      useNativeCodexTargetStore.getState().select({
        threadId: conversation.id,
        cwd: conversation.cwd,
        column: selectedColumn,
      });
      setSelectedProject(conversation.cwd);
      setMobilePane("native");
    } catch (cause) {
      setResumeError(
        cause instanceof Error ? cause.message : "Codex 会话打开失败",
      );
    } finally {
      setOpeningThreadId(null);
    }
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
    const key = `${windowId}:${threadId}`;
    if (restoreAttempts.current.has(key)) return;
    restoreAttempts.current.add(key);
    restorePending.current.add(panelIndex);
    setRestoringPanels(Array.from(restorePending.current).sort());
    lockFrameForRestore();
    const restore = async () => {
      try {
        await fetch("/api/native-codex/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ windowId, threadId, column: panelIndex + 1 }),
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
      </header>
      <div className="codex-workbench-main" data-mobile-pane={mobilePane}>
        <CodexProjectNavigation
          projects={projects}
          projectsLoading={projectsLoading}
          projectsError={projectsError}
          selectedProject={selectedProject}
          selectedState={
            selectedProject ? conversationStates[selectedProject] : undefined
          }
          canResume={Boolean(
            status?.available && status.resumeAvailable === true,
          )}
          openingThreadId={openingThreadId}
          mobilePane={mobilePane}
          onSelectProject={selectProject}
          onRetryProjects={retryProjects}
          onRetryConversations={retryConversations}
          onOpenConversation={(conversation) =>
            void resumeConversation(conversation)
          }
        />
        <div className="codex-native-workspace">
          <div className="codex-mode-toolbar">
            <div className="codex-current-project">
              <strong>Codex</strong>
              <span>
                {selectedProject?.split("/").filter(Boolean).at(-1) ??
                  "选择项目会话"}
              </span>
              {selectedProject &&
                conversationStates[selectedProject] &&
                !conversationStates[selectedProject]!.loading &&
                !conversationStates[selectedProject]!.error && (
                  <span>
                    {conversationStates[selectedProject]!.conversations.length}{" "}
                    个会话
                  </span>
                )}
            </div>
            <div
              className="codex-window-target"
              role="group"
              aria-label="当前 Codex 窗口"
            >
              {[1, 2].map((column) => (
                <button
                  key={column}
                  type="button"
                  aria-label={"Codex 窗口 " + column}
                  aria-pressed={selectedColumn === column}
                  onClick={() => setSelectedColumn(column)}
                >
                  {column}
                </button>
              ))}
            </div>
            {panels > 0 && <span>{panels} 个窗口</span>}
            {status?.available &&
              status.resumeAvailable &&
              status.sendAvailable === false && (
                <span role="status">公共输入桥接暂不可用</span>
              )}
            {panels > readyPanels && (
              <span role="status">
                正在加载窗口（{readyPanels}/{panels}）
              </span>
            )}
            {status?.available && status.resumeAvailable !== true && (
              <span role="status">正在连接原生 Codex 窗口…</span>
            )}
            {restoringPanels.length > 0 && (
              <span role="status">
                正在恢复 Codex 窗口（
                {restoringPanels.map((index) => index + 1).join("、")}）
              </span>
            )}
            {resumeError && (
              <span className="codex-resume-error" role="alert">
                {resumeError}
              </span>
            )}
            <button
              type="button"
              className="codex-mobile-session-back"
              onClick={() => setMobilePane("sessions")}
            >
              项目会话
            </button>
            <button type="button" onClick={retryConnection}>
              重试连接
            </button>
          </div>
          <main className="codex-mode-canvas">
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
                  try {
                    const document = frame.current?.contentDocument;
                    if (!document)
                      throw new Error("原生 Codex 界面暂时无法连接");
                    const next = mountNativeSurface(
                      document,
                      (count) => {
                        setPanels(count);
                      },
                      (count) => {
                        setReadyPanels(count);
                        if (count > 0) setLoadError(null);
                      },
                      {
                        windowIds: status?.newChatWindowIds,
                        onThreadState: (panelIndex, state) => {
                          const windowIds = status?.newChatWindowIds;
                          const windowId = windowIds?.[panelIndex];
                          if (!windowId) return;
                          latestWindowState.current.set(windowId, state);
                          const pendingTimer =
                            restoreTimers.current.get(windowId);
                          if (pendingTimer !== undefined) {
                            window.clearTimeout(pendingTimer);
                            restoreTimers.current.delete(windowId);
                          }
                          if (!state.ready || !state.hasComposer) return;
                          let storage: Storage;
                          try {
                            storage = window.localStorage;
                          } catch {
                            return;
                          }
                          if (state.conversationId) {
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
          </main>
        </div>
      </div>
    </section>
  );
}
