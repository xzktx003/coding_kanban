import { requestTimeout } from "./lib/requestTimeout";
import { ThemeProvider } from "./contexts/ThemeContext";
import { OfflineWorkspace } from "./components/common/OfflineWorkspace";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useAgentCenterStore } from "./stores/useAgentCenterStore";
import { startSessionProjectsSync } from "./services/sessionProjectsSync";
import { startSessionTabsSync } from "./services/sessionTabsSync";
import { startFollowedSessionStatusSync } from "./services/followedSessionStatusSync";
import { startFollowedSessionHistorySync } from "./services/followedSessionHistorySync";
import { startSessionTranscriptCache } from "./services/sessionTranscriptCache";
import { startFollowedSessionAuxSync } from "./services/followedSessionAuxSync";
import { startSessionMemoryGovernor } from "./services/sessionMemoryGovernor";
import { startSessionTranscriptRetention } from "./services/sessionTranscriptRetention";
import { useCodexStore } from "./components/codex/stores";
import { useCCStore } from "./stores/cc";
import { useAttentionStorageSync } from "./hooks/useSessionReadReceipt";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import App from "./App";
import "./session-theme.css";
import "./session-interactions.css";
import "./session-split-drag.css";
import "./session-composer.css";
import "./session-composer-v2.css";
import "./session-navigation.css";
import "./session-selection.css";
import "./session-composer-compact.css";
import { useComposerViewport } from "./components/codex/composer/v2/useComposerViewport";

import { SessionTopNavigation } from "./components/layout/SessionTopNavigation";
import type { WorkbenchMode } from "../lib/workbench-mode";

function SessionWorkbenchContent({
  onModeChange,
  active = true,
}: { onModeChange?: (mode: WorkbenchMode) => void; active?: boolean } = {}) {
  useComposerViewport();
  useAttentionStorageSync();
  useEffect(() => startSessionTranscriptCache(), []);
  useEffect(() => startSessionTranscriptRetention(), []);
  useEffect(() => startSessionMemoryGovernor(), []);
  useEffect(() => {
    const tabs = startSessionTabsSync(),
      projects = startSessionProjectsSync();
    return () => {
      tabs();
      projects();
    };
  }, []);
  const [status, setStatus] = useState<"checking" | "ready" | "offline">(
    "checking",
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // Health is only a probe, not the lifetime of an established session.
    // A failed probe must not remove the workers needed to recover lost events;
    // the read-only workers own their deadlines, retries and visibility gates.
    if (!loaded) return;
    const statuses = startFollowedSessionStatusSync();
    const histories = startFollowedSessionHistorySync();
    const auxiliary = startFollowedSessionAuxSync();
    return () => {
      statuses();
      histories();
      auxiliary();
    };
  }, [loaded]);
  const instance = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const hasProjects = useWorkspaceStore(
    (s) =>
      s.projectsInitialized ||
      s.pendingProjectOperations.length > 0 ||
      s.projects.length > 0,
  );
  const hasTabs = useAgentCenterStore(
    (s) =>
      s.sharedTabsInitialized ||
      s.pendingTabOperations.length > 0 ||
      s.cards.length > 0,
  );
  const tabsSyncError = useAgentCenterStore((s) => s.tabSyncError);
  const cachedCodex = useCodexStore((s) =>
    Object.keys(s.events).some((id) => !!s.historyLoadedMap[id]),
  );
  const cachedClaude = useCCStore((s) =>
    Object.values(s.sessionMessagesMap).some((messages) => messages.length > 0),
  );
  const hasCachedTranscript = cachedCodex || cachedClaude;
  const projectsSyncError = useWorkspaceStore((s) => s.projectSyncError);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    window.dispatchEvent(new Event("session-connection-retry"));
    setAttempt((value) => value + 1);
  }, []);
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
  if (
    !loaded &&
    !hasCachedTranscript &&
    status !== "ready" &&
    (hasProjects || hasTabs)
  )
    return (
      <div className="session-workbench">
        <SessionTopNavigation
          status={status}
          onModeChange={onModeChange}
          active={active}
        />
        <div className="flex-1 min-h-0">
          <OfflineWorkspace retry={retry} />
        </div>
      </div>
    );
  if (!loaded && !hasCachedTranscript && status !== "ready")
    return (
      <div className="session-workbench">
        <SessionTopNavigation
          status={status}
          onModeChange={onModeChange}
          active={active}
        />
        <div
          className="session-connection-state"
          role={status === "offline" ? "alert" : "status"}
        >
          <div className="session-connection-icon">
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
            <button onClick={retry}>
              <RefreshCw size={15} />
              重试连接
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="session-workbench">
      <SessionTopNavigation
        status={status}
        onModeChange={onModeChange}
        active={active}
      />
      {(loaded || hasCachedTranscript) && status === "offline" && (
        <div className="session-outage" role="alert">
          <span>会话服务连接中断，正在自动重连。草稿已保留。</span>
          {connectionError && <span>{connectionError}</span>}
          <button onClick={retry}>立即重试</button>
        </div>
      )}
      {(tabsSyncError || projectsSyncError) && (
        <div className="session-outage" role="status">
          <span>同步待重试</span>
          <span>修改已保存在本机，连接恢复后自动同步。</span>
          <button onClick={retry}>立即同步</button>
        </div>
      )}
      <div className="session-content">
        <App />
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
