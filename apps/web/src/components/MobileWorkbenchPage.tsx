import type { RefObject } from "react";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  isLocalCodexSessionCandidate,
  type AgentSessionRecord,
} from "@agent-orchestrator/shared";

import type { AgentCompletionNotificationPermission } from "../lib/agent-completion-notifications";
import { sendAgentInput } from "../lib/api";
import { AgentTranscriptDialog } from "./AgentTranscriptDialog";
import { ChangesPanel } from "./ChangesPanel";
import { LazyTerminalView } from "./LazyTerminalView";
import { MobileAgentComposer } from "./MobileAgentComposer";
import { MobileFileBrowser } from "./MobileFileBrowser";
import { MobileTerminalToolbar } from "./MobileTerminalToolbar";

interface MobileWorkbenchPageProps {
  activeSessionId: string | null;
  isLoading: boolean;
  sessions: AgentSessionRecord[];
  terminalFontSize?: number;
  useLightweightTerminalPreview?: boolean;
  agentCompletionNotificationsEnabled?: boolean;
  agentCompletionNotificationPermission?: AgentCompletionNotificationPermission;
  onSwitchSession: (id: string) => void;
  onTerminalFontSizeChange?: (fontSize: number) => void;
  onToggleAgentCompletionNotifications?: () => void;
}

type MobileWorkbenchView = "board" | "activity" | "session" | "projects";
type MobileAttentionGroup = "response" | "review" | "executing" | "ready";

const stateLabels: Record<string, string> = {
  running: "执行中",
  idle: "可继续",
  awaiting_input: "需响应",
  detached: "已分离",
  exited: "已退出",
};

const connectionLabels: Record<string, string> = {
  online: "已连接",
  degraded: "连接不稳",
  offline: "已断开",
};

const attentionGroups: Array<{
  id: MobileAttentionGroup;
  label: string;
  description: string;
}> = [
  { id: "response", label: "需响应", description: "等待你的回答或确认" },
  { id: "review", label: "待验收", description: "Agent 已完成，等待查看" },
  { id: "executing", label: "执行中", description: "Agent 正在处理任务" },
  { id: "ready", label: "可继续", description: "可以继续输入或检查" },
];

const sessionPickerGroupOrder: MobileAttentionGroup[] = [
  "ready",
  "executing",
  "response",
  "review",
];
const sessionNameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base",
});

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestActivity(session: AgentSessionRecord): number {
  return Math.max(
    timestampValue(session.lastOutputAt),
    timestampValue(session.lastHeartbeatAt),
    timestampValue(session.lastRefreshedAt),
    timestampValue(
      isLocalCodexSessionCandidate(session)
        ? session.taskSummaryUpdatedAt
        : undefined,
    ),
  );
}

function getAttentionGroup(session: AgentSessionRecord): MobileAttentionGroup {
  if (session.interactionState === "awaiting_input") return "response";
  if (session.hasUnreadCompletion) return "review";
  if (session.interactionState === "running") return "executing";
  return "ready";
}

function attentionRank(session: AgentSessionRecord): number {
  return attentionGroups.findIndex(
    (group) => group.id === getAttentionGroup(session),
  );
}

export function sortMobileSessionsByAttention(
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const rankDifference =
        attentionRank(left.session) - attentionRank(right.session);
      if (rankDifference !== 0) return rankDifference;

      const activityDifference =
        latestActivity(right.session) - latestActivity(left.session);
      return activityDifference !== 0
        ? activityDifference
        : left.index - right.index;
    })
    .map(({ session }) => session);
}

export function sortMobileSessionPickerSessions(
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] {
  return [...sessions].sort((left, right) => {
    const groupDifference =
      sessionPickerGroupOrder.indexOf(getAttentionGroup(left)) -
      sessionPickerGroupOrder.indexOf(getAttentionGroup(right));
    if (groupDifference !== 0) return groupDifference;

    const nameDifference = sessionNameCollator.compare(
      left.displayName.trim(),
      right.displayName.trim(),
    );
    return nameDifference !== 0
      ? nameDifference
      : sessionNameCollator.compare(left.id, right.id);
  });
}

function formatActivityTime(session: AgentSessionRecord): string {
  const timestamp = Math.max(
    timestampValue(session.lastOutputAt),
    timestampValue(session.lastHeartbeatAt),
    timestampValue(session.lastRefreshedAt),
  );
  if (!timestamp) return "暂无活动时间";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function shortenPath(path?: string): string {
  if (!path) return "未提供工作目录";
  return path.replace(/^\/(?:data\d+\/)?home\/[^/]+/, "~");
}

export function getMobileSessionSummary(session: AgentSessionRecord): string {
  const supportsStructuredSummary = isLocalCodexSessionCandidate(session);
  return (
    (supportsStructuredSummary ? session.lastAgentMessageSummary : undefined) ??
    (supportsStructuredSummary ? session.lastUserMessageSummary : undefined) ??
    session.outputPreview?.split(/\r?\n/).filter(Boolean).slice(-1)[0] ??
    "暂无摘要，进入当前会话查看详情。"
  );
}

function MobileSessionCard({
  session,
  onOpen,
}: {
  session: AgentSessionRecord;
  onOpen: (session: AgentSessionRecord) => void;
}) {
  const attentionGroup = getAttentionGroup(session);
  return (
    <button
      className={`mobile-session-card mobile-session-card--${attentionGroup}`}
      data-session-id={session.id}
      onClick={() => onOpen(session)}
      type="button"
    >
      <span className="mobile-session-card-heading">
        <strong>{session.displayName}</strong>
        <span>
          {stateLabels[session.interactionState] ?? session.interactionState}
        </span>
      </span>
      <span className="mobile-session-card-summary">
        {getMobileSessionSummary(session)}
      </span>
      <span className="mobile-session-card-meta">
        <span>
          {session.projectName ?? shortenPath(session.workingDirectory)}
        </span>
        <span>{session.agentKind}</span>
        <span>{formatActivityTime(session)}</span>
      </span>
    </button>
  );
}

interface MobileSessionSwitcherProps {
  activeSession?: AgentSessionRecord;
  containerRef?: RefObject<HTMLDivElement | null>;
  onOpenChanges: () => void;
  onOpenFiles: () => void;
  onOpenTranscript: () => void;
  onSelectSession: (session: AgentSessionRecord) => void;
  onToggle: () => void;
  open: boolean;
  sessions: AgentSessionRecord[];
}

export function MobileSessionSwitcher({
  activeSession,
  containerRef,
  onOpenChanges,
  onOpenFiles,
  onOpenTranscript,
  onSelectSession,
  onToggle,
  open,
  sessions,
}: MobileSessionSwitcherProps) {
  const menuOpen = open && Boolean(activeSession);

  return (
    <div className="mobile-session-switcher" ref={containerRef}>
      <span>当前会话</span>
      <button
        aria-controls="mobile-session-picker-list"
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        className="mobile-session-picker-trigger"
        disabled={!activeSession}
        onClick={onToggle}
        type="button"
      >
        <span>{activeSession?.displayName ?? "没有可用会话"}</span>
      </button>
      <div className="mobile-session-actions">
        <button
          className="mobile-transcript-btn"
          disabled={!activeSession}
          onClick={onOpenTranscript}
          type="button"
        >
          完整记录
        </button>
        <button
          className="mobile-transcript-btn"
          disabled={!activeSession}
          onClick={onOpenChanges}
          type="button"
        >
          变更
        </button>
        <button
          className="mobile-transcript-btn"
          disabled={!activeSession}
          onClick={onOpenFiles}
          type="button"
        >
          文件
        </button>
      </div>
      {menuOpen && (
        <div
          aria-label="选择终端会话"
          className="mobile-session-picker-menu"
          id="mobile-session-picker-list"
          role="listbox"
        >
          {sessions.map((session) => (
            <button
              aria-selected={session.id === activeSession?.id}
              key={session.id}
              onClick={() => onSelectSession(session)}
              role="option"
              type="button"
            >
              <span>{session.displayName}</span>
              <small>
                {stateLabels[session.interactionState] ??
                  session.interactionState}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MobileWorkbenchPage({
  activeSessionId,
  isLoading,
  sessions,
  terminalFontSize,
  useLightweightTerminalPreview = true,
  agentCompletionNotificationsEnabled = false,
  agentCompletionNotificationPermission = "unsupported",
  onSwitchSession,
  onTerminalFontSizeChange,
  onToggleAgentCompletionNotifications,
}: MobileWorkbenchPageProps) {
  const [view, setView] = useState<MobileWorkbenchView>("session");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    activeSessionId,
  );
  const [transcriptSession, setTranscriptSession] =
    useState<AgentSessionRecord | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [fileBrowserSessionId, setFileBrowserSessionId] = useState<
    string | null
  >(null);
  const [sessionFilesOpen, setSessionFilesOpen] = useState(false);
  const sessionSwitcherRef = useRef<HTMLDivElement>(null);
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session.hidden),
    [sessions],
  );
  const attentionSortedSessions = useMemo(
    () => sortMobileSessionsByAttention(visibleSessions),
    [visibleSessions],
  );
  const sessionPickerSortedSessions = useMemo(
    () => sortMobileSessionPickerSessions(visibleSessions),
    [visibleSessions],
  );
  const activitySortedSessions = useMemo(
    () =>
      [...visibleSessions].sort(
        (left, right) => latestActivity(right) - latestActivity(left),
      ),
    [visibleSessions],
  );
  const activeSession = useMemo(
    () =>
      visibleSessions.find((session) => session.id === selectedSessionId) ??
      visibleSessions.find((session) => session.id === activeSessionId) ??
      attentionSortedSessions[0],
    [
      activeSessionId,
      attentionSortedSessions,
      selectedSessionId,
      visibleSessions,
    ],
  );
  const projectGroups = useMemo(() => {
    const groups = new Map<string, AgentSessionRecord[]>();
    for (const session of visibleSessions) {
      const location =
        session.repositoryRoot ??
        session.workingDirectory ??
        session.projectName ??
        "未归属项目";
      const host = session.sshTarget
        ? `${session.sshTarget.username ?? ""}@${session.sshTarget.host}:${session.sshTarget.port ?? 22}`
        : "local";
      const key = `${host}:${location}`;
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [visibleSessions]);
  const fileBrowserSession = visibleSessions.find(
    (session) => session.id === fileBrowserSessionId,
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

  useEffect(() => {
    if (!sessionPickerOpen) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !sessionSwitcherRef.current?.contains(target)) {
        setSessionPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSessionPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [sessionPickerOpen]);

  const openSession = (session: AgentSessionRecord) => {
    setSessionPickerOpen(false);
    setSessionFilesOpen(false);
    setSelectedSessionId(session.id);
    onSwitchSession(session.id);
    setView("session");
  };

  const navigateToSession = () => {
    setSessionPickerOpen(false);
    setSessionFilesOpen(false);
    if (activeSession) {
      setSelectedSessionId(activeSession.id);
      onSwitchSession(activeSession.id);
    }
    setView("session");
  };

  const handleSendInput = (input: string): Promise<void> => {
    const sessionId = activeSession?.id;
    if (!sessionId) return Promise.reject(new Error("没有可用会话"));

    const pending = inputQueueRef.current.then(async () => {
      await sendAgentInput(sessionId, { input });
    });
    inputQueueRef.current = pending.catch(() => undefined);
    return pending;
  };

  return (
    <main className="mobile-workbench-page">
      <header className="mobile-workbench-header">
        <div className="mobile-workbench-mode-switch" aria-label="端切换">
          <div className="mobile-workbench-title">
            <strong>手机端 Coding Kanban</strong>
            <span>
              {activeSession
                ? `${activeSession.projectName ?? activeSession.hostId ?? "默认工作区"} · ${connectionLabels[activeSession.connectionState] ?? activeSession.connectionState}`
                : "暂无可用会话"}
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
      </header>

      <section className="mobile-workbench-content">
        {view === "board" && (
          <div className="mobile-workspace-view">
            <div className="mobile-view-heading">
              <div>
                <span>ATTENTION QUEUE</span>
                <h1>手机工作区</h1>
              </div>
              <strong>{visibleSessions.length} 个会话</strong>
            </div>
            {isLoading ? (
              <div className="mobile-workbench-empty">正在加载会话...</div>
            ) : attentionSortedSessions.length === 0 ? (
              <div className="mobile-workbench-empty">
                暂无会话，请到电脑端新建或接入会话。
              </div>
            ) : (
              attentionGroups.map((group) => {
                const groupSessions = attentionSortedSessions.filter(
                  (session) => getAttentionGroup(session) === group.id,
                );
                if (groupSessions.length === 0) return null;
                return (
                  <section className="mobile-attention-group" key={group.id}>
                    <header>
                      <div>
                        <h2>{group.label}</h2>
                        <span>{group.description}</span>
                      </div>
                      <strong>{groupSessions.length}</strong>
                    </header>
                    <div className="mobile-session-list">
                      {groupSessions.map((session) => (
                        <MobileSessionCard
                          key={session.id}
                          onOpen={openSession}
                          session={session}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}

        {view === "activity" && (
          <div className="mobile-workspace-view">
            <div className="mobile-view-heading">
              <div>
                <span>RECENT UPDATES</span>
                <h1>最近活动</h1>
              </div>
            </div>
            <div className="mobile-activity-list">
              {activitySortedSessions.map((session) => (
                <button
                  className="mobile-activity-item"
                  key={session.id}
                  onClick={() => openSession(session)}
                  type="button"
                >
                  <span
                    className={`mobile-activity-dot mobile-activity-dot--${getAttentionGroup(session)}`}
                  />
                  <span>
                    <strong>{session.displayName}</strong>
                    <small>{getMobileSessionSummary(session)}</small>
                  </span>
                  <time>{formatActivityTime(session)}</time>
                </button>
              ))}
              {!isLoading && activitySortedSessions.length === 0 && (
                <div className="mobile-workbench-empty">暂无活动。</div>
              )}
            </div>
          </div>
        )}

        {view === "projects" && (
          <div className="mobile-workspace-view">
            {fileBrowserSession ? (
              <MobileFileBrowser
                onBack={() => setFileBrowserSessionId(null)}
                session={fileBrowserSession}
              />
            ) : (
              <>
                <div className="mobile-view-heading">
                  <div>
                    <span>WORKSPACES</span>
                    <h1>项目与文件</h1>
                  </div>
                </div>
                <div className="mobile-project-list">
                  {projectGroups.map(([project, projectSessions]) => (
                    <section className="mobile-project-card" key={project}>
                      <header>
                        <div>
                          <strong>
                            {projectSessions[0]?.projectName ??
                              projectSessions[0]?.repositoryRoot ??
                              projectSessions[0]?.workingDirectory ??
                              "未归属项目"}
                          </strong>
                          <span>
                            {shortenPath(projectSessions[0]?.workingDirectory)}
                          </span>
                        </div>
                        <div className="mobile-project-card-controls">
                          <span>{projectSessions.length} 个会话</span>
                          <button
                            onClick={() =>
                              setFileBrowserSessionId(projectSessions[0]!.id)
                            }
                            type="button"
                          >
                            浏览文件
                          </button>
                        </div>
                      </header>
                      {projectSessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => openSession(session)}
                          type="button"
                        >
                          <span>{session.displayName}</span>
                          <small>{stateLabels[session.interactionState]}</small>
                        </button>
                      ))}
                    </section>
                  ))}
                  {!isLoading && projectGroups.length === 0 && (
                    <div className="mobile-workbench-empty">
                      暂无项目或文件入口。
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {view === "session" && (
          <div className="mobile-session-view">
            {sessionFilesOpen && activeSession ? (
              <MobileFileBrowser
                backLabel="返回终端"
                onBack={() => setSessionFilesOpen(false)}
                session={activeSession}
              />
            ) : (
              <>
                <MobileSessionSwitcher
                  activeSession={activeSession}
                  containerRef={sessionSwitcherRef}
                  onOpenChanges={() => {
                    setSessionPickerOpen(false);
                    setChangesOpen(true);
                  }}
                  onOpenFiles={() => {
                    setSessionPickerOpen(false);
                    if (activeSession) setSessionFilesOpen(true);
                  }}
                  onOpenTranscript={() => {
                    setSessionPickerOpen(false);
                    if (activeSession) setTranscriptSession(activeSession);
                  }}
                  onSelectSession={openSession}
                  onToggle={() => setSessionPickerOpen((current) => !current)}
                  open={sessionPickerOpen}
                  sessions={sessionPickerSortedSessions}
                />
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
                        <p>没有可用会话。</p>
                      </div>
                    )}
                  </div>
                </section>
                <MobileTerminalToolbar
                  disabled={!activeSession}
                  onSendInput={handleSendInput}
                />
                <MobileAgentComposer
                  disabled={!activeSession}
                  onSendInput={handleSendInput}
                />
              </>
            )}
          </div>
        )}
      </section>

      <nav aria-label="手机端主导航" className="mobile-primary-nav">
        <button
          aria-label="看板"
          className={view === "board" ? "active" : ""}
          onClick={() => {
            setSessionPickerOpen(false);
            setSessionFilesOpen(false);
            setView("board");
          }}
          type="button"
        >
          <span>▦</span>看板
        </button>
        <button
          aria-label="活动"
          className={view === "activity" ? "active" : ""}
          onClick={() => {
            setSessionPickerOpen(false);
            setSessionFilesOpen(false);
            setView("activity");
          }}
          type="button"
        >
          <span>◴</span>活动
        </button>
        <button
          aria-label="当前会话"
          className={view === "session" ? "active" : ""}
          onClick={navigateToSession}
          type="button"
        >
          <span>⌁</span>当前会话
        </button>
        <button
          aria-label="项目/文件"
          className={view === "projects" ? "active" : ""}
          onClick={() => {
            setSessionPickerOpen(false);
            setSessionFilesOpen(false);
            setView("projects");
          }}
          type="button"
        >
          <span>▤</span>项目/文件
        </button>
      </nav>

      {changesOpen && activeSession && (
        <div className="mobile-changes-overlay">
          <ChangesPanel
            compact
            session={activeSession}
            onClose={() => setChangesOpen(false)}
          />
        </div>
      )}
      {transcriptSession && (
        <AgentTranscriptDialog
          key={transcriptSession.id}
          agentSessionId={transcriptSession.id}
          displayName={transcriptSession.displayName}
          onClose={() => setTranscriptSession(null)}
          terminalFontSize={terminalFontSize}
          useLightweightTerminalPreview={useLightweightTerminalPreview}
        />
      )}
    </main>
  );
}
