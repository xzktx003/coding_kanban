import { OfflineWorkspace } from "./components/common/OfflineWorkspace";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useAgentCenterStore } from "./stores/useAgentCenterStore";
import { startSessionProjectsSync } from "./services/sessionProjectsSync";
import { startSessionTabsSync } from "./services/sessionTabsSync";
import { startFollowedSessionStatusSync } from "./services/followedSessionStatusSync";
import { useAttentionStorageSync } from "./hooks/useSessionReadReceipt";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import App from "./App";
import "./session-theme.css";
import "./session-interactions.css";

import { SessionTopNavigation } from "./components/layout/SessionTopNavigation";
import type { WorkbenchMode } from "../lib/workbench-mode";

export default function SessionWorkbench({
  onModeChange,
}: { onModeChange?: (mode: WorkbenchMode) => void } = {}) {
  useAttentionStorageSync();
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
  useEffect(() => {
    if (status === "ready") return startFollowedSessionStatusSync();
  }, [status]);
  const instance = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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
  const projectsSyncError = useWorkspaceStore((s) => s.projectSyncError);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setStatus("checking");
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    async function check() {
      try {
        const response = await fetch("/api/session/health", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        if (!response.ok) throw new Error("unavailable");
        const body = await response.json();
        if (body.status !== "ok") throw new Error("not ready");
        if (typeof body.instance === "string") {
          if (instance.current && instance.current !== body.instance)
            window.dispatchEvent(new Event("session-runtime-restarted"));
          instance.current = body.instance;
        }
        tries = 0;
        setLoaded(true);
        setStatus("ready");
        timer = setTimeout(check, 10_000);
      } catch {
        if (controller.signal.aborted) return;
        setStatus("checking");
        if (++tries < 5) timer = setTimeout(check, 1500);
        else {
          setStatus("offline");
          timer = setTimeout(check, 10_000);
        }
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);
  if (!loaded && status !== "ready" && (hasProjects || hasTabs))
    return (
      <div className="session-workbench">
        <SessionTopNavigation status={status} onModeChange={onModeChange} />
        <div className="flex-1 min-h-0">
          <OfflineWorkspace retry={retry} />
        </div>
      </div>
    );
  if (!loaded && status !== "ready")
    return (
      <div className="session-workbench">
        <SessionTopNavigation status={status} onModeChange={onModeChange} />
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
      <SessionTopNavigation status={status} onModeChange={onModeChange} />
      {loaded && status === "offline" && (
        <div className="session-outage" role="alert">
          会话服务连接中断，正在自动重连。草稿已保留。
          <button onClick={retry}>立即重试</button>
        </div>
      )}
      {(tabsSyncError || projectsSyncError) && (
        <div className="session-outage" role="status">
          <span>同步待重试</span>
          <span>修改已保存在本机，连接恢复后自动同步。</span>
        </div>
      )}
      <div className="session-content">
        <App />
      </div>
    </div>
  );
}
