import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentSessionRecord,
  SshHostPreset,
  TerminalHistoryDiagnosticsResponse,
  VsCodeWebProxyDiagnosticsResponse,
} from "@agent-orchestrator/shared";

import {
  getTerminalHistoryDiagnostics,
  getVsCodeWebProxyDiagnostics,
} from "../lib/api";
import { getQuickTmuxShortcutLabel } from "../lib/platform-compat";
import {
  classifyResourcePressure,
  getResourceDiagnosticsSnapshot,
  type ResourceDiagnosticsSnapshot,
} from "../lib/resource-diagnostics";
import {
  clampTerminalFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "../lib/terminal-font-size";
import type { AgentCompletionNotificationPermission } from "../lib/agent-completion-notifications";
import { TERMINAL_SCROLLBACK_LINES } from "../lib/terminal-history-config";
import { focusActiveTerminalTextarea } from "../lib/terminal-focus";
import type { VsCodeIframeCacheMode } from "../lib/vscode-cache";

import { HostDropdown, type SelectedHost } from "./HostDropdown";

const RESOURCE_DIAGNOSTICS_POLL_MS = 1_000;

type TopBarMenuId = "scan" | "tools" | "resource";

function formatKilobytes(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)} KB`;
}

function formatBytes(value: number): string {
  const kilobytes = value / 1024;
  if (kilobytes < 1024) {
    return formatKilobytes(kilobytes);
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
}

function formatKilobytesPerSecond(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)} KB/s`;
}

function formatMessagesPerSecond(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} msg/s`;
}

function formatMegabytes(value: number | undefined): string {
  if (value === undefined) {
    return "浏览器未暴露";
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} MB`;
}

function getHeapSummary(snapshot: ResourceDiagnosticsSnapshot): string {
  const { memory } = snapshot;

  if (memory.usedJSHeapMegabytes === undefined) {
    return "浏览器未暴露";
  }

  return [
    formatMegabytes(memory.usedJSHeapMegabytes),
    memory.totalJSHeapMegabytes === undefined
      ? null
      : `已分配 ${formatMegabytes(memory.totalJSHeapMegabytes)}`,
    memory.jsHeapLimitMegabytes === undefined
      ? null
      : `上限 ${formatMegabytes(memory.jsHeapLimitMegabytes)}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function getMainThreadSummary(snapshot: ResourceDiagnosticsSnapshot): string {
  const { mainThread } = snapshot;

  if (
    !mainThread.longTaskObserverSupported &&
    mainThread.totalLongTasks === 0
  ) {
    return "浏览器未暴露";
  }

  return [
    `${mainThread.longTasksPerSecond.toFixed(2)} task/s`,
    `${mainThread.blockedMillisecondsPerSecond.toFixed(1)} ms/s`,
    `累计 ${mainThread.totalLongTasks}`,
    `最近 ${mainThread.lastLongTaskMilliseconds.toFixed(0)} ms`,
  ].join(" / ");
}

function getVsCodeProxyHttpSummary(
  diagnostics: VsCodeWebProxyDiagnosticsResponse | null,
): string {
  if (!diagnostics) {
    return "后端未返回";
  }

  return [
    `${diagnostics.http.requestsPerSecond.toFixed(2)} req/s`,
    `↑ ${formatKilobytesPerSecond(diagnostics.http.uploadKilobytesPerSecond)}`,
    `↓ ${formatKilobytesPerSecond(diagnostics.http.downloadKilobytesPerSecond)}`,
    `active ${diagnostics.http.activeRequests}`,
    diagnostics.http.lastStatusCode === null
      ? null
      : `last ${diagnostics.http.lastStatusCode}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function getVsCodeProxyWebSocketSummary(
  diagnostics: VsCodeWebProxyDiagnosticsResponse | null,
): string {
  if (!diagnostics) {
    return "后端未返回";
  }

  return [
    `${diagnostics.websocket.messagesPerSecond.toFixed(2)} msg/s`,
    `↑ ${formatKilobytesPerSecond(diagnostics.websocket.uploadKilobytesPerSecond)}`,
    `↓ ${formatKilobytesPerSecond(diagnostics.websocket.downloadKilobytesPerSecond)}`,
    `active ${diagnostics.websocket.activeConnections}`,
  ].join(" / ");
}

function getTerminalHistorySummary(
  diagnostics: TerminalHistoryDiagnosticsResponse | null,
): string {
  if (!diagnostics) {
    return "后端未返回";
  }

  return [
    `PTY ${formatBytes(diagnostics.pty.totalScrollbackBytes)} / 上限 ${formatBytes(
      diagnostics.pty.maxScrollbackBytes,
    )}`,
    diagnostics.pty.totalDroppedScrollbackBytes > 0
      ? `已裁剪 ${formatBytes(diagnostics.pty.totalDroppedScrollbackBytes)}`
      : "未裁剪",
    `tmux ${diagnostics.tmux.captureLines} 行`,
    `fallback ${diagnostics.registry.maxOutputEntries} 条`,
    `xterm ${TERMINAL_SCROLLBACK_LINES} 行`,
  ].join(" / ");
}

interface TopBarProps {
  sessions: AgentSessionRecord[];
  collapsed: boolean;
  sshHosts: SshHostPreset[];
  fileBrowserAvailable: boolean;
  fileBrowserOpen: boolean;
  vscodeAvailable: boolean;
  vscodeOpen: boolean;
  vscodeIframeCacheMode: VsCodeIframeCacheMode;
  vscodeCacheReleaseAvailable: boolean;
  useLightweightTerminalPreview: boolean;
  terminalFontSize: number;
  agentCompletionNotificationsEnabled: boolean;
  agentCompletionNotificationPermission: AgentCompletionNotificationPermission;
  connectionStatus?: "connecting" | "connected" | "disconnected" | "reconnecting";
  onToggleCollapsed: () => void;
  onToggleFileBrowser: () => void;
  onToggleVsCode: () => void;
  onToggleVsCodeIframeCacheMode: () => void;
  onReleaseVsCodeIframeCache: () => void;
  onToggleTerminalPreviewMode: () => void;
  onTerminalFontSizeChange: (fontSize: number) => void;
  onToggleAgentCompletionNotifications: () => void;
  onOpenNewSession: (host: SelectedHost) => void;
  onScanTmux: (host: SelectedHost) => void;
  onScanApps: (host: SelectedHost) => void;
}

export function TopBar({
  sessions,
  collapsed,
  sshHosts,
  fileBrowserAvailable,
  fileBrowserOpen,
  vscodeAvailable,
  vscodeOpen,
  vscodeIframeCacheMode,
  vscodeCacheReleaseAvailable,
  useLightweightTerminalPreview,
  terminalFontSize,
  agentCompletionNotificationsEnabled,
  agentCompletionNotificationPermission,
  connectionStatus,
  onToggleCollapsed,
  onToggleFileBrowser,
  onToggleVsCode,
  onToggleVsCodeIframeCacheMode,
  onReleaseVsCodeIframeCache,
  onToggleTerminalPreviewMode,
  onTerminalFontSizeChange,
  onToggleAgentCompletionNotifications,
  onOpenNewSession,
  onScanTmux,
  onScanApps,
}: TopBarProps) {
  const quickTmuxShortcutLabel = getQuickTmuxShortcutLabel();
  const [showHints, setShowHints] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] =
    useState<ResourceDiagnosticsSnapshot>(() =>
      getResourceDiagnosticsSnapshot(),
    );
  const [vscodeProxyDiagnostics, setVsCodeProxyDiagnostics] =
    useState<VsCodeWebProxyDiagnosticsResponse | null>(null);
  const [terminalHistoryDiagnostics, setTerminalHistoryDiagnostics] =
    useState<TerminalHistoryDiagnosticsResponse | null>(null);
  const [draftTerminalFontSize, setDraftTerminalFontSize] =
    useState(terminalFontSize);
  const [isDraggingTerminalFontSize, setIsDraggingTerminalFontSize] =
    useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);
  const topBarUtilityRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<TopBarMenuId | null>(null);
  const hintsPopoverId = "operation-hints-popover";
  const diagnosticsPopoverId = "resource-diagnostics-popover";
  const totalCount = sessions.length;
  const notificationUnsupported =
    agentCompletionNotificationPermission === "unsupported";
  const notificationDenied = agentCompletionNotificationPermission === "denied";
  const notificationStatusLabel = notificationUnsupported
    ? "需要 HTTPS"
    : notificationDenied
      ? "权限已拒绝"
      : agentCompletionNotificationsEnabled
        ? "完成通知：开"
        : "完成通知：关";
  const resourceFindings = classifyResourcePressure({
    snapshot: diagnosticsSnapshot,
    terminalHistoryDiagnostics,
    useLightweightTerminalPreview,
    vscodeProxyDiagnostics,
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        topBarUtilityRef.current &&
        target &&
        !topBarUtilityRef.current.contains(target)
      ) {
        setOpenMenu(null);
        setShowHints(false);
        setShowDiagnostics(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setShowHints(false);
        setShowDiagnostics(false);
      }
      if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleFullscreen]);

  const toggleMenu = (menuId: TopBarMenuId) => {
    setOpenMenu((current) => (current === menuId ? null : menuId));
    setShowHints(false);
    setShowDiagnostics(false);
  };

  useEffect(() => {
    if (!isDraggingTerminalFontSize) {
      setDraftTerminalFontSize(terminalFontSize);
    }
  }, [isDraggingTerminalFontSize, terminalFontSize]);

  const commitTerminalFontSize = useCallback(
    (value: number) => {
      const nextFontSize = clampTerminalFontSize(value);
      setIsDraggingTerminalFontSize(false);
      setDraftTerminalFontSize(nextFontSize);
      if (nextFontSize !== terminalFontSize) {
        onTerminalFontSizeChange(nextFontSize);
      }
    },
    [onTerminalFontSizeChange, terminalFontSize],
  );

  const commitTerminalFontSizeFromPointer = useCallback(
    (value: number) => {
      commitTerminalFontSize(value);
      focusActiveTerminalTextarea();
    },
    [commitTerminalFontSize],
  );

  const closeMenus = () => {
    setOpenMenu(null);
  };

  const openHints = () => {
    setOpenMenu(null);
    setShowHints((current) => !current);
    setShowDiagnostics(false);
  };

  const openDiagnostics = () => {
    setOpenMenu(null);
    setShowDiagnostics((current) => !current);
    setShowHints(false);
  };

  useEffect(() => {
    if (!showDiagnostics) {
      return;
    }

    let cancelled = false;
    const refreshDiagnostics = () => {
      setDiagnosticsSnapshot(getResourceDiagnosticsSnapshot());
      void getVsCodeWebProxyDiagnostics()
        .then((diagnostics) => {
          if (!cancelled) {
            setVsCodeProxyDiagnostics(diagnostics);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setVsCodeProxyDiagnostics(null);
          }
        });
      void getTerminalHistoryDiagnostics()
        .then((diagnostics) => {
          if (!cancelled) {
            setTerminalHistoryDiagnostics(diagnostics);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTerminalHistoryDiagnostics(null);
          }
        });
    };

    refreshDiagnostics();
    const intervalId = window.setInterval(
      refreshDiagnostics,
      RESOURCE_DIAGNOSTICS_POLL_MS,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showDiagnostics]);

  if (collapsed) {
    return (
      <header className="top-bar top-bar--collapsed">
        <span className="top-bar-collapsed-title">电脑端 Coding Kanban</span>
        <button
          className="top-bar-expand-btn"
          data-testid="top-bar-expand"
          onClick={onToggleCollapsed}
          title="展开菜单栏"
          type="button"
        >
          ▾ 展开菜单栏
        </button>
      </header>
    );
  }

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <div className="top-bar-mode-switch" aria-label="端切换">
          <h1 className="top-bar-title">电脑端 Coding Kanban</h1>
          <a
            className="top-bar-mode-link"
            href="/?view=mobile"
            title="切换到手机端终端控制页"
          >
            手机端 Coding Kanban
          </a>
        </div>
        <div className="top-bar-stats">
          {connectionStatus && connectionStatus !== "connected" && (
            <span
              className={`stat-item connection-status connection-status--${connectionStatus}`}
              data-testid="connection-status"
              title={
                connectionStatus === "connecting"
                  ? "正在连接服务器..."
                  : connectionStatus === "reconnecting"
                    ? "连接中断，正在重连..."
                    : "连接已断开"
              }
            >
              {connectionStatus === "connecting" && "⚡ 连接中..."}
              {connectionStatus === "reconnecting" && "⚡ 重连中..."}
              {connectionStatus === "disconnected" && "✗ 连接断开"}
            </span>
          )}
          <span className="stat-item">
            共 <strong>{totalCount}</strong> 个会话
          </span>
        </div>
      </div>
      <div className="top-bar-actions" ref={topBarUtilityRef}>
        <div className="top-bar-primary-actions">
          <HostDropdown
            sshHosts={sshHosts}
            onSelectHost={onOpenNewSession}
            triggerLabel="新建会话"
            buttonTestId="new-session-toggle"
            triggerClassName="top-bar-action top-bar-action--primary"
          />
          <div className="top-bar-menu">
            <button
              aria-controls="top-bar-scan-menu"
              aria-expanded={openMenu === "scan"}
              className={`top-bar-action${openMenu === "scan" ? " top-bar-action--active" : ""}`}
              data-testid="scan-menu-toggle"
              onClick={() => toggleMenu("scan")}
              type="button"
            >
              扫描 ▾
            </button>
            {openMenu === "scan" && (
              <div
                aria-label="扫描入口"
                className="top-bar-menu-popover top-bar-menu-popover--scan"
                id="top-bar-scan-menu"
                role="menu"
              >
                <HostDropdown
                  sshHosts={sshHosts}
                  onSelectHost={(host) => {
                    closeMenus();
                    onScanTmux(host);
                  }}
                  triggerLabel="扫描 tmux"
                  buttonTestId="btn-扫描 tmux"
                  triggerClassName="top-bar-menu-item"
                />
                <HostDropdown
                  sshHosts={sshHosts}
                  onSelectHost={(host) => {
                    closeMenus();
                    onScanApps(host);
                  }}
                  triggerLabel="扫描会话"
                  buttonTestId="btn-扫描会话"
                  triggerClassName="top-bar-menu-item"
                />
              </div>
            )}
          </div>
        </div>
        <div className="top-bar-context-actions">
          <button
            className={`top-bar-action${fileBrowserOpen ? " top-bar-action--active" : ""}`}
            data-testid="file-browser-toggle"
            disabled={!fileBrowserAvailable}
            onClick={onToggleFileBrowser}
            title={
              fileBrowserAvailable
                ? "打开当前终端的文件浏览器"
                : "仅在终端聚焦态可用"
            }
            type="button"
          >
            📁 文件
          </button>
          <button
            className={`top-bar-action${vscodeOpen ? " top-bar-action--active" : ""}`}
            data-testid="vscode-toggle"
            disabled={!vscodeAvailable}
            onClick={onToggleVsCode}
            title={
              vscodeAvailable
                ? "打开当前终端的 VS Code Web"
                : "仅在终端聚焦态可用"
            }
            type="button"
          >
            <span>VS Code</span>
          </button>
        </div>
        <div className="top-bar-secondary-actions">
          <label
            className="top-bar-terminal-font-control"
            title="调整所有内置终端的字体大小"
          >
            <span>终端字号</span>
            <input
              aria-label="终端字号"
              data-testid="terminal-font-size-slider"
              max={MAX_TERMINAL_FONT_SIZE}
              min={MIN_TERMINAL_FONT_SIZE}
              onBlur={(event) =>
                commitTerminalFontSize(Number(event.currentTarget.value))
              }
              onChange={(event) =>
                setDraftTerminalFontSize(
                  clampTerminalFontSize(Number(event.currentTarget.value)),
                )
              }
              onKeyUp={(event) =>
                commitTerminalFontSize(Number(event.currentTarget.value))
              }
              onPointerCancel={(event) =>
                commitTerminalFontSizeFromPointer(
                  Number(event.currentTarget.value),
                )
              }
              onPointerDown={() => setIsDraggingTerminalFontSize(true)}
              onPointerUp={(event) =>
                commitTerminalFontSizeFromPointer(
                  Number(event.currentTarget.value),
                )
              }
              step={1}
              type="range"
              value={draftTerminalFontSize}
            />
            <strong>{draftTerminalFontSize}px</strong>
          </label>
          <div className="top-bar-menu">
            <button
              aria-controls="top-bar-tools-menu"
              aria-expanded={openMenu === "tools"}
              className={`top-bar-action top-bar-action--ghost${openMenu === "tools" || showHints ? " top-bar-action--active" : ""}`}
              data-testid="tools-menu-toggle"
              onClick={() => toggleMenu("tools")}
              type="button"
            >
              工具 ▾
            </button>
            {openMenu === "tools" && (
              <div
                aria-label="工具入口"
                className="top-bar-menu-popover"
                id="top-bar-tools-menu"
                role="menu"
              >
                <button
                  aria-controls={hintsPopoverId}
                  aria-expanded={showHints}
                  className="top-bar-menu-item"
                  data-testid="help-hints-toggle"
                  onClick={openHints}
                  type="button"
                >
                  <span>操作提示</span>
                  <small>快捷键和基础操作</small>
                </button>
                <button
                  className={`top-bar-menu-item${agentCompletionNotificationsEnabled ? " top-bar-menu-item--active" : ""}`}
                  data-testid="agent-completion-notification-toggle"
                  disabled={notificationUnsupported || notificationDenied}
                  onClick={onToggleAgentCompletionNotifications}
                  title={
                    notificationUnsupported
                      ? "需要 HTTPS 安全上下文才能使用浏览器通知（当前为 HTTP）"
                      : notificationDenied
                        ? "浏览器已拒绝通知权限，请在浏览器设置中开启"
                        : "Agent 从运行中进入空闲或退出时发送浏览器通知"
                  }
                  type="button"
                >
                  <span>{notificationStatusLabel}</span>
                  <small>{notificationUnsupported ? "请通过 HTTPS 访问本页" : "Agent 完成后提醒查看"}</small>
                </button>
                {agentCompletionNotificationsEnabled && (
                  <button
                    className="top-bar-menu-item"
                    onClick={() => {
                      if (typeof Notification === "undefined") {
                        alert("浏览器不支持 Notification API");
                        return;
                      }
                      if (Notification.permission !== "granted") {
                        alert(`通知权限状态: ${Notification.permission}\n请先允许浏览器通知权限`);
                        return;
                      }
                      new Notification("Coding Kanban 测试通知", {
                        body: "如果你能看到这条通知，说明浏览器通知正常工作。",
                        tag: "notification-test",
                      });
                    }}
                    type="button"
                  >
                    <span>发送测试通知</span>
                    <small>验证浏览器通知是否可用</small>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="top-bar-menu">
            <button
              aria-controls="top-bar-resource-menu"
              aria-expanded={openMenu === "resource"}
              className={`top-bar-action top-bar-action--ghost${openMenu === "resource" || showDiagnostics ? " top-bar-action--active" : ""}`}
              data-testid="resource-tuning-menu-toggle"
              onClick={() => toggleMenu("resource")}
              type="button"
            >
              资源调节 ▾
            </button>
            {openMenu === "resource" && (
              <div
                aria-label="资源调节"
                className="top-bar-menu-popover"
                id="top-bar-resource-menu"
                role="menu"
              >
                <button
                  className={`top-bar-menu-item${useLightweightTerminalPreview ? " top-bar-menu-item--active" : ""}`}
                  data-testid="terminal-preview-mode-toggle"
                  onClick={onToggleTerminalPreviewMode}
                  title={
                    useLightweightTerminalPreview
                      ? "当前为轻量化预览：非活跃会话不打开终端 WebSocket"
                      : "当前为完整终端预览：恢复旧版小终端模式"
                  }
                  type="button"
                >
                  <span>
                    {useLightweightTerminalPreview
                      ? "轻量预览：开"
                      : "完整预览"}
                  </span>
                  <small>终端卡片预览模式</small>
                </button>
                <button
                  className={`top-bar-menu-item${vscodeIframeCacheMode === "memory-saving" ? " top-bar-menu-item--active" : ""}`}
                  data-testid="vscode-cache-mode-toggle"
                  onClick={onToggleVsCodeIframeCacheMode}
                  title={
                    vscodeIframeCacheMode === "memory-saving"
                      ? "当前为 VS Code 省内存模式：只保留当前 iframe，并使用轻量终端预览"
                      : "当前为 VS Code 保持状态模式：最多保留最近 8 个 iframe，并完整渲染运行终端窗格"
                  }
                  type="button"
                >
                  <span>
                    {vscodeIframeCacheMode === "memory-saving"
                      ? "VS Code 省内存"
                      : "VS Code 保持状态"}
                  </span>
                  <small>iframe 缓存模式</small>
                </button>
                <button
                  className="top-bar-menu-item"
                  data-testid="vscode-cache-release"
                  disabled={!vscodeCacheReleaseAvailable}
                  onClick={onReleaseVsCodeIframeCache}
                  title="卸载非当前 VS Code iframe，释放浏览器内存"
                  type="button"
                >
                  <span>释放 VS Code 缓存</span>
                  <small>卸载隐藏 iframe</small>
                </button>
                <button
                  aria-controls={diagnosticsPopoverId}
                  aria-expanded={showDiagnostics}
                  className="top-bar-menu-item"
                  data-testid="resource-diagnostics-toggle"
                  onClick={openDiagnostics}
                  title="查看浏览器内存、终端实例和 WebSocket 吞吐指标"
                  type="button"
                >
                  <span>资源诊断</span>
                  <small>内存、WebSocket 和 VS Code 指标</small>
                </button>
              </div>
            )}
          </div>
          <button
            className={`top-bar-action top-bar-action--ghost top-bar-icon-action${isFullscreen ? " top-bar-action--active" : ""}`}
            data-testid="fullscreen-toggle"
            onClick={toggleFullscreen}
            title={isFullscreen ? "退出全屏" : "进入全屏"}
            type="button"
          >
            ⛶
          </button>
          <button
            className="top-bar-collapse-btn top-bar-icon-action"
            data-testid="top-bar-collapse"
            onClick={onToggleCollapsed}
            title="折叠菜单栏"
            type="button"
          >
            ▴
          </button>
        </div>
        {showHints && (
          <div
            aria-label="操作提示"
            className="top-bar-hints-popover"
            id={hintsPopoverId}
            role="dialog"
          >
            <div className="top-bar-hint-item">
              <kbd>双击</kbd>
              <span>卡片放大</span>
            </div>
            <div className="top-bar-hint-item">
              <kbd>Alt+Q</kbd>
              <span>返回宫格</span>
            </div>
            <div className="top-bar-hint-item">
              <kbd>{quickTmuxShortcutLabel}</kbd>
              <span>快连 tmux</span>
            </div>
            <div className="top-bar-hint-item">
              <kbd>Tab</kbd>
              <span>切换焦点</span>
            </div>
            <div className="top-bar-hint-item">
              <kbd>F11</kbd>
              <span>全屏切换</span>
            </div>
          </div>
        )}
        {showDiagnostics && (
          <div
            aria-label="资源诊断"
            className="top-bar-resource-popover"
            data-testid="resource-diagnostics-popover"
            id={diagnosticsPopoverId}
            role="dialog"
          >
            <div className="resource-diagnostics-header">
              <strong>浏览器资源诊断</strong>
              <span>打开时每秒刷新，不保存历史</span>
            </div>
            <div className="resource-diagnostics-grid">
              <span>预览模式</span>
              <strong>
                {useLightweightTerminalPreview ? "轻量预览" : "完整预览"}
              </strong>
              <span>xterm 实例</span>
              <strong>{diagnosticsSnapshot.dom.xtermCount}</strong>
              <span>终端视图</span>
              <strong>
                {diagnosticsSnapshot.dom.terminalViewCount}（主终端{" "}
                {diagnosticsSnapshot.dom.liveTerminalViewCount} / 预览{" "}
                {diagnosticsSnapshot.dom.previewTerminalViewCount}）
              </strong>
              <span>监控窗格</span>
              <strong>
                {diagnosticsSnapshot.dom.monitorTerminalPaneCount}（输入{" "}
                {diagnosticsSnapshot.dom.activeInputTerminalPaneCount}）
              </strong>
              <span>轻量预览 DOM</span>
              <strong>{diagnosticsSnapshot.dom.lightweightPreviewCount}</strong>
              <span>终端 WebSocket</span>
              <strong>
                {diagnosticsSnapshot.terminalSockets.total}（open{" "}
                {diagnosticsSnapshot.terminalSockets.open} / connecting{" "}
                {diagnosticsSnapshot.terminalSockets.connecting}）
              </strong>
              <span>会话快照 WS</span>
              <strong>
                {formatMessagesPerSecond(
                  diagnosticsSnapshot.agentSessionSocket.messagesPerSecond,
                )}
                {" · "}
                {formatKilobytesPerSecond(
                  diagnosticsSnapshot.agentSessionSocket.kilobytesPerSecond,
                )}
              </strong>
              <span>快照累计/单帧</span>
              <strong>
                {diagnosticsSnapshot.agentSessionSocket.totalMessages} 条 / 累计{" "}
                {formatKilobytes(
                  diagnosticsSnapshot.agentSessionSocket.totalKilobytes,
                )}{" "}
                / 单帧{" "}
                {formatKilobytes(
                  diagnosticsSnapshot.agentSessionSocket.lastPayloadKilobytes,
                )}
              </strong>
              <span>终端实时流</span>
              <strong>
                {formatMessagesPerSecond(
                  diagnosticsSnapshot.terminalFrames.messagesPerSecond,
                )}
                {" · "}
                {formatKilobytesPerSecond(
                  diagnosticsSnapshot.terminalFrames.kilobytesPerSecond,
                )}
              </strong>
              <span>终端历史缓冲</span>
              <strong>
                {getTerminalHistorySummary(terminalHistoryDiagnostics)}
              </strong>
              <span>VS Code iframe</span>
              <strong>
                {diagnosticsSnapshot.dom.vscodeIframeCount}（当前{" "}
                {diagnosticsSnapshot.dom.vscodeActiveIframeCount} / 隐藏{" "}
                {diagnosticsSnapshot.dom.vscodeHiddenIframeCount}）
              </strong>
              <span>主线程长任务</span>
              <strong>{getMainThreadSummary(diagnosticsSnapshot)}</strong>
              <span>VS Code代理 HTTP</span>
              <strong>
                {getVsCodeProxyHttpSummary(vscodeProxyDiagnostics)}
              </strong>
              <span>VS Code代理 WS</span>
              <strong>
                {getVsCodeProxyWebSocketSummary(vscodeProxyDiagnostics)}
              </strong>
              <span>JS heap</span>
              <strong>{getHeapSummary(diagnosticsSnapshot)}</strong>
            </div>
            <div className="resource-diagnostics-findings">
              <strong>当前判读</strong>
              <ul>
                {resourceFindings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
