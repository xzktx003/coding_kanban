import { Suspense, useLayoutEffect, useMemo, useState } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import type { AgentCompletionNotificationPermission } from "../lib/agent-completion-notifications";
import { sendAgentInput } from "../lib/api";
import { AgentTranscriptDialog } from "./AgentTranscriptDialog";
import { LazyTerminalView } from "./LazyTerminalView";
import { MobileAgentComposer } from "./MobileAgentComposer";
import { MobileTerminalToolbar } from "./MobileTerminalToolbar";

interface MobileWorkbenchPageProps {
  activeSessionId: string | null;
  isLoading: boolean;
  sessions: AgentSessionRecord[];
  terminalFontSize?: number;
  agentCompletionNotificationsEnabled?: boolean;
  agentCompletionNotificationPermission?: AgentCompletionNotificationPermission;
  onSwitchSession: (id: string) => void;
  onTerminalFontSizeChange?: (fontSize: number) => void;
  onToggleAgentCompletionNotifications?: () => void;
}

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  awaiting_input: "等待输入",
  detached: "已分离",
  exited: "已退出",
};

export function MobileWorkbenchPage({
  activeSessionId,
  isLoading,
  sessions,
  terminalFontSize,
  agentCompletionNotificationsEnabled = false,
  agentCompletionNotificationPermission = "unsupported",
  onSwitchSession,
  onTerminalFontSizeChange,
  onToggleAgentCompletionNotifications,
}: MobileWorkbenchPageProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendingInput, setSendingInput] = useState(false);
  const [transcriptSession, setTranscriptSession] =
    useState<AgentSessionRecord | null>(null);
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session.hidden),
    [sessions],
  );
  const activeSession = useMemo(
    () =>
      visibleSessions.find((session) => session.id === activeSessionId) ??
      visibleSessions[0],
    [activeSessionId, visibleSessions],
  );
  const notificationUnsupported =
    agentCompletionNotificationPermission === "unsupported";
  const notificationDenied = agentCompletionNotificationPermission === "denied";
  const notificationStatusLabel = notificationUnsupported
    ? "通知不可用"
    : notificationDenied
      ? "通知被拒"
      : agentCompletionNotificationsEnabled
        ? "通知开"
        : "通知关";

  useLayoutEffect(() => {
    document.documentElement.classList.add("mobile-terminal-route");
    document.body.classList.add("mobile-terminal-route");
    return () => {
      document.documentElement.classList.remove("mobile-terminal-route");
      document.body.classList.remove("mobile-terminal-route");
    };
  }, []);

  const handleSendInput = async (input: string) => {
    if (!activeSession || sendingInput) {
      return;
    }

    setErrorMessage(null);
    setSendingInput(true);
    try {
      await sendAgentInput(activeSession.id, { input });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSendingInput(false);
    }
  };

  return (
    <main className="mobile-workbench-page">
      <header className="mobile-workbench-header">
        <div className="mobile-workbench-mode-switch" aria-label="端切换">
          <div className="mobile-workbench-title">
            <strong>手机端 Coding Kanban</strong>
            <span>
              {activeSession?.displayName ?? "无可用会话"}
              {activeSession
                ? ` · ${stateLabels[activeSession.interactionState] ?? activeSession.interactionState} · ${activeSession.agentKind}`
                : ""}
            </span>
          </div>
          <a className="mobile-workbench-desktop-link" href="/">
            电脑端 Coding Kanban
          </a>
          {onToggleAgentCompletionNotifications && (
            <button
              className={`mobile-workbench-notification-toggle${agentCompletionNotificationsEnabled ? " mobile-workbench-notification-toggle--active" : ""}`}
              data-testid="mobile-agent-completion-notification-toggle"
              disabled={notificationUnsupported || notificationDenied}
              onClick={onToggleAgentCompletionNotifications}
              title={
                notificationUnsupported
                  ? "当前浏览器不支持系统通知"
                  : notificationDenied
                    ? "浏览器已拒绝通知权限，请在浏览器设置中开启"
                    : "Agent 完成后发送浏览器通知"
              }
              type="button"
            >
              {notificationStatusLabel}
            </button>
          )}
        </div>
        <div className="mobile-session-switcher">
          <span>会话</span>
          <select
            disabled={!activeSession}
            onChange={(event) => onSwitchSession(event.target.value)}
            value={activeSession?.id ?? ""}
          >
            {visibleSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.displayName}
              </option>
            ))}
          </select>
          <button
            className="mobile-transcript-btn"
            disabled={!activeSession}
            onClick={() => activeSession && setTranscriptSession(activeSession)}
            title="查看不受终端重绘影响的完整 Codex 记录"
            type="button"
          >
            完整记录
          </button>
        </div>
      </header>

      <section className="mobile-terminal-surface">
        <div className="mobile-terminal-frame">
          {isLoading ? (
            <div className="grid-empty">
              <p>正在加载...</p>
            </div>
          ) : activeSession ? (
            <Suspense
              fallback={
                <div className="grid-empty">
                  <p>正在加载终端...</p>
                </div>
              }
            >
              <LazyTerminalView
                agentSessionId={activeSession.id}
                fontSize={terminalFontSize}
                inputEnabled={false}
                interactive
                mobileTouchMode
                onFontSizeChange={onTerminalFontSizeChange}
              />
            </Suspense>
          ) : (
            <div className="grid-empty">
              <p>没有可用会话。请先回到桌面端新建或接入一个会话。</p>
            </div>
          )}
        </div>
      </section>

      {errorMessage && (
        <div className="mobile-workbench-error" role="alert">
          {errorMessage}
        </div>
      )}

      <MobileTerminalToolbar
        disabled={!activeSession || sendingInput}
        onSendInput={handleSendInput}
      />
      <MobileAgentComposer
        disabled={!activeSession || sendingInput}
        onSendInput={handleSendInput}
      />
      {transcriptSession && (
        <AgentTranscriptDialog
          agentSessionId={transcriptSession.id}
          displayName={transcriptSession.displayName}
          onClose={() => setTranscriptSession(null)}
          terminalFontSize={terminalFontSize}
        />
      )}
    </main>
  );
}
