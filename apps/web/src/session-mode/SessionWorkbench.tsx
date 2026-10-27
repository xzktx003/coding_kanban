import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MessageSquare } from "lucide-react";
import { requestTimeout } from "./lib/requestTimeout";
import { ThemeProvider } from "./contexts/ThemeContext";
import { OfflineWorkspace } from "./components/common/OfflineWorkspace";
import { useCCStore } from "./stores/cc/ccStore";
import { useAgentCenterStore } from "./stores/useAgentCenterStore";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useCodexStore } from "./components/codex/stores/useCodexStore";
import { SessionTopNavigation } from "./components/layout/SessionTopNavigation";
import type { WorkbenchMode } from "../lib/workbench-mode";
import { loadSessionApp, preloadSessionApp } from "./sessionWorkbenchLoader";
import "./session-theme.css";
import "./session-interactions.css";
import "./session-split-drag.css";
import "./session-composer.css";
import "./session-composer-v2.css";
import "./session-navigation.css";
import "./session-selection.css";
import "./session-composer-compact.css";

const SessionAppBody = lazy(loadSessionApp);
const SessionWorkbenchEffects = lazy(() => import("./SessionWorkbenchEffects"));

type ConnectionStatus = "checking" | "ready" | "offline";

function SessionNotice({
  title,
  role,
  children,
}: {
  title: string;
  role: "alert" | "status";
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="session-outage" role={role}>
      <div className="session-outage-heading">
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`${expanded ? "收起" : "展开"}${title}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "详情"}
        </button>
      </div>
      {expanded && <div className="session-outage-details">{children}</div>}
    </div>
  );
}

function SessionWorkbenchContent({
  onModeChange,
  active = true,
}: { onModeChange?: (mode: WorkbenchMode) => void; active?: boolean } = {}) {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [loaded, setLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const instance = useRef<string | null>(null);
  const hasProjects = useWorkspaceStore(
    (state) =>
      state.projectsInitialized ||
      state.pendingProjectOperations.length > 0 ||
      state.projects.length > 0,
  );
  const hasTabs = useAgentCenterStore(
    (state) =>
      state.sharedTabsInitialized ||
      state.pendingTabOperations.length > 0 ||
      state.cards.length > 0,
  );
  const tabsSyncError = useAgentCenterStore((state) => state.tabSyncError);
  const projectsSyncError = useWorkspaceStore(
    (state) => state.projectSyncError,
  );
  const hasCachedCodex = useCodexStore((state) =>
    Object.keys(state.events).some((id) => !!state.historyLoadedMap[id]),
  );
  const hasCachedClaude = useCCStore((state) =>
    Object.values(state.sessionMessagesMap).some(
      (messages) => messages.length > 0,
    ),
  );
  const hasCachedTranscript = hasCachedCodex || hasCachedClaude;
  const retry = useCallback(() => {
    window.dispatchEvent(new Event("session-connection-retry"));
    setAttempt((value) => value + 1);
  }, []);

  // Load the active application and visible conversation while the bounded
  // health probe runs. The idle workbench preload never evaluates these
  // modules or starts their browser listeners.
  useEffect(() => {
    preloadSessionApp();
  }, []);

  // These services own the active session lifecycle. Importing this module
  // during idle preloading must not start history/SSE work.
  useEffect(() => {
    let disposed = false;
    let stops: Array<() => void> = [];
    void Promise.all([
      import("./services/sessionTranscriptCache"),
      import("./services/sessionTranscriptRetention"),
      import("./services/sessionMemoryGovernor"),
      import("./services/sessionTabsSync"),
      import("./services/sessionProjectsSync"),
    ])
      .then(([cache, retention, memory, tabs, projects]) => {
        if (disposed) return;
        stops = [
          cache.startSessionTranscriptCache(),
          retention.startSessionTranscriptRetention(),
          memory.startSessionMemoryGovernor(),
          tabs.startSessionTabsSync(),
          projects.startSessionProjectsSync(),
        ];
      })
      .catch((error: unknown) => {
        if (!disposed)
          console.error("Unable to start session background services", error);
      });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    let stops: Array<() => void> = [];
    void Promise.all([
      import("./services/followedSessionStatusSync"),
      import("./services/followedSessionHistorySync"),
      import("./services/followedSessionAuxSync"),
    ])
      .then(([statusSync, historySync, auxSync]) => {
        if (disposed) return;
        stops = [
          statusSync.startFollowedSessionStatusSync(),
          historySync.startFollowedSessionHistorySync(),
          auxSync.startFollowedSessionAuxSync(),
        ];
      })
      .catch((error: unknown) => {
        if (!disposed)
          console.error("Unable to start session history recovery", error);
      });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [loaded]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    async function check() {
      const deadline = requestTimeout(controller.signal, 5000);
      try {
        const response = await fetch("/api/session/health", {
          cache: "no-store",
          signal: deadline.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (body.status !== "ok") throw new Error("not ready");
        if (typeof body.instance === "string") {
          if (instance.current && instance.current !== body.instance)
            window.dispatchEvent(new Event("session-runtime-restarted"));
          instance.current = body.instance;
        }
        tries = 0;
        setConnectionError(null);
        setLoaded(true);
        setStatus("ready");
        timer = setTimeout(check, 10_000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setConnectionError(
          error instanceof Error && /^HTTP \d{3}$/.test(error.message)
            ? `服务返回 ${error.message}`
            : error instanceof Error && error.name === "TimeoutError"
              ? "连接检测请求超时（5 秒）"
              : error instanceof TypeError
                ? "浏览器无法访问服务，请检查网络或证书"
                : error instanceof SyntaxError
                  ? "服务返回的数据格式错误"
                  : "会话服务尚未就绪",
        );
        setStatus("checking");
        if (++tries < 5) timer = setTimeout(check, 1500);
        else {
          setStatus("offline");
          timer = setTimeout(check, 10_000);
        }
      } finally {
        deadline.dispose();
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "hidden") retry();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [retry]);

  return (
    <div className="session-workbench">
      <Suspense fallback={null}>
        <SessionWorkbenchEffects />
      </Suspense>
      <SessionTopNavigation
        status={status}
        onModeChange={onModeChange}
        active={active}
      />
      <div className="session-notices-anchor">
        <div className="session-notices">
          {(loaded || hasCachedTranscript) && status === "offline" && (
            <SessionNotice title="会话服务连接中断" role="alert">
              <span>正在自动重连。草稿已保留。</span>
              {connectionError && <span>{connectionError}</span>}
              <button onClick={retry}>立即重试</button>
            </SessionNotice>
          )}
          {(tabsSyncError || projectsSyncError) && (
            <SessionNotice title="同步待重试" role="status">
              <span>修改已保存在本机，连接恢复后自动同步。</span>
              <button onClick={retry}>立即同步</button>
            </SessionNotice>
          )}
        </div>
      </div>
      <div className="session-content">
        {!loaded && !hasCachedTranscript && status !== "ready" ? (
          status === "offline" && (hasProjects || hasTabs) ? (
            <OfflineWorkspace retry={retry} />
          ) : (
            <div
              className="session-connection-state"
              role={status === "offline" ? "alert" : "status"}
            >
              <div className="session-connection-icon" aria-hidden="true">
                <MessageSquare size={26} />
              </div>
              <h1>
                {status === "checking"
                  ? "正在连接会话工作台"
                  : "会话服务暂时不可用"}
              </h1>
              <p>
                {status === "checking"
                  ? "准备项目、历史记录和 Agent 连接…"
                  : "请重试连接；终端模式可以继续使用。"}
              </p>
              {status === "offline" && (
                <button onClick={retry}>重试连接</button>
              )}
            </div>
          )
        ) : (
          <Suspense
            fallback={
              <div className="session-app-loading" role="status">
                正在准备会话内容…
              </div>
            }
          >
            <SessionAppBody />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default function SessionWorkbench(
  props: {
    onModeChange?: (mode: WorkbenchMode) => void;
    active?: boolean;
  } = {},
) {
  return (
    <ThemeProvider>
      <SessionWorkbenchContent {...props} />
    </ThemeProvider>
  );
}
