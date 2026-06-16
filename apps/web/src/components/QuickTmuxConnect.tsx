import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentSessionRecord,
  SshHostPreset,
} from "@agent-orchestrator/shared";

import {
  shellQuote,
  formatWorkingDirectory,
} from "@agent-orchestrator/shared";
import { getSshHosts, launchPtyAgent, launchSshPtyAgent } from "../lib/api";
import { saveRecentConnection, loadRecentConnections, type RecentTmuxConnection } from "../lib/recent-connections";
import { DEFAULT_TMUX_HISTORY_LIMIT_LINES } from "../lib/session-matching";

interface QuickTmuxConnectProps {
  open: boolean;
  onClose: () => void;
  onConnected: (session: AgentSessionRecord) => void;
}



function buildQuickTmuxCommand(
  tmuxSessionName: string,
  workingDirectory: string,
): string {
  return `exec tmux set-option -g history-limit ${DEFAULT_TMUX_HISTORY_LIMIT_LINES} \\; new-session -A -s ${shellQuote(tmuxSessionName)} -c ${formatWorkingDirectory(workingDirectory)}`;
}

function buildDefaultQuickTmuxName(hostName: string): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return `${hostName}-tmux-${timestamp}`;
}

function matchesHost(host: SshHostPreset, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [host.name, host.host, host.username ?? ""];
  const normalizedQuery = query.toLowerCase();

  return haystacks.some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

// Virtual localhost host for quick tmux connection
const LOCALHOST_HOST: SshHostPreset = {
  name: "本机",
  host: "localhost",
  username: "",
  port: 22,
  identityFile: "",
  defaultPath: "~/",
};

interface ExtendedHost extends SshHostPreset {
  isLocalhost?: boolean;
}

export function QuickTmuxConnect({
  open,
  onClose,
  onConnected,
}: QuickTmuxConnectProps) {
  const [hosts, setHosts] = useState<ExtendedHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hostQuery, setHostQuery] = useState("");
  const [selectedHost, setSelectedHost] = useState<ExtendedHost | null>(null);
  const [recentConnections] = useState<RecentTmuxConnection[]>(() => loadRecentConnections());
  const [sessionName, setSessionName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const hostSearchRef = useRef<HTMLInputElement>(null);
  const sessionNameRef = useRef<HTMLInputElement>(null);

  const allHosts = useMemo<ExtendedHost[]>(() => {
    return [{ ...LOCALHOST_HOST, isLocalhost: true }, ...hosts];
  }, [hosts]);

  const filteredHosts = useMemo(
    () => allHosts.filter((host) => matchesHost(host, hostQuery)),
    [hostQuery, allHosts],
  );

  useEffect(() => {
    if (!open) {
      setLoadingHosts(false);
      setSubmitting(false);
      setErrorMessage(null);
      setHostQuery("");
      setSelectedHost(null);
      setSessionName("");
      setWorkingDirectory("");
      return;
    }

    let cancelled = false;
    setLoadingHosts(true);
    setErrorMessage(null);

    getSshHosts()
      .then((response) => {
        if (!cancelled) {
          setHosts(response.hosts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("SSH 主机列表加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHosts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTarget = selectedHost
      ? sessionNameRef.current
      : hostSearchRef.current;
    const timerId = window.setTimeout(() => {
      focusTarget?.focus();
      focusTarget?.select();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [open, selectedHost]);

  if (!open) {
    return null;
  }

  function handleClose() {
    if (submitting) {
      return;
    }

    onClose();
  }

  function handleSelectHost(host: ExtendedHost) {
    setSelectedHost(host);
    setErrorMessage(null);
    setWorkingDirectory(host.defaultPath || "~/");
  }

  function handleHostSearchKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      const firstHost = filteredHosts[0];
      if (!firstHost) {
        return;
      }

      event.preventDefault();
      handleSelectHost(firstHost);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    if (selectedHost) {
      setSelectedHost(null);
      setSessionName("");
      setWorkingDirectory("");
      setErrorMessage(null);
      return;
    }

    handleClose();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedHost || submitting) {
      return;
    }

    const nextSessionName =
      sessionName.trim() || buildDefaultQuickTmuxName(selectedHost.name);
    const nextWorkingDirectory =
      workingDirectory.trim() || selectedHost.defaultPath || "~/";

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const launchedSession = selectedHost.isLocalhost
        ? await launchPtyAgent({
            workspaceId: "default",
            displayName: nextSessionName,
            agentKind: "shell",
            command: buildQuickTmuxCommand(
              nextSessionName,
              nextWorkingDirectory,
            ),
            workingDirectory: nextWorkingDirectory,
            tmuxSessionName: nextSessionName,
          })
        : await launchSshPtyAgent({
            workspaceId: "default",
            displayName: nextSessionName,
            agentKind: "shell",
            sshTarget: {
              host: selectedHost.host,
              port: selectedHost.port,
              username: selectedHost.username,
              identityFile: selectedHost.identityFile,
            },
            remoteCommand: buildQuickTmuxCommand(
              nextSessionName,
              nextWorkingDirectory,
            ),
            workingDirectory: nextWorkingDirectory,
            tmuxSessionName: nextSessionName,
          });

      saveRecentConnection({
        hostName: selectedHost.name,
        hostId: selectedHost.host,
        sessionName: nextSessionName,
        workingDirectory: nextWorkingDirectory,
      });
      onConnected(launchedSession);
      onClose();
    } catch {
      setErrorMessage(`tmux 连接失败: ${selectedHost.name}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="quick-tmux-backdrop" onClick={handleClose}>
      <div
        aria-labelledby="quick-tmux-connect-title"
        aria-modal="true"
        className="quick-tmux-dialog"
        data-testid="quick-tmux-connect-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
      >
        <div className="quick-tmux-header">
          <div>
            <p className="quick-tmux-kicker">快捷连接</p>
            <h2 id="quick-tmux-connect-title" className="quick-tmux-title">
              {selectedHost ? `连接 ${selectedHost.name}` : "快速连接 tmux"}
            </h2>
          </div>
          <button
            className="quick-tmux-close"
            onClick={handleClose}
            type="button"
          >
            关闭
          </button>
        </div>

        {!selectedHost ? (
          <div className="quick-tmux-step">
            {recentConnections.length > 0 && !hostQuery && (
              <div className="quick-tmux-recent" data-testid="recent-connections">
                <span className="quick-tmux-recent-label">最近连接</span>
                {recentConnections.slice(0, 3).map((conn, idx) => (
                  <button
                    key={`${conn.hostId}-${conn.sessionName}-${idx}`}
                    className="quick-tmux-recent-item"
                    onClick={() => {
                      const matchedHost = allHosts.find(h => h.host === conn.hostId || h.name === conn.hostName);
                      if (matchedHost) {
                        setSelectedHost(matchedHost);
                        setWorkingDirectory(conn.workingDirectory);
                        setSessionName(conn.sessionName);
                      }
                    }}
                    type="button"
                  >
                    <span className="quick-tmux-recent-host">{conn.hostName}</span>
                    <span className="quick-tmux-recent-session">{conn.sessionName}</span>
                    <span className="quick-tmux-recent-dir">{conn.workingDirectory}</span>
                  </button>
                ))}
              </div>
            )}
            <label
              className="quick-tmux-label"
              htmlFor="quick-tmux-host-search"
            >
              选择服务器
            </label>
            <input
              ref={hostSearchRef}
              className="quick-tmux-input"
              data-testid="quick-tmux-host-search"
              id="quick-tmux-host-search"
              onChange={(event) => setHostQuery(event.target.value)}
              onKeyDown={handleHostSearchKeyDown}
              placeholder="输入主机名、IP 或用户名，比如 hm24"
              value={hostQuery}
            />
            <div className="quick-tmux-host-list">
              {loadingHosts ? (
                <p className="quick-tmux-message">正在加载 SSH 主机...</p>
              ) : filteredHosts.length === 0 ? (
                <p className="quick-tmux-message">没有匹配的主机</p>
              ) : (
                filteredHosts.map((host) => (
                  <button
                    key={host.name}
                    className="quick-tmux-host-item"
                    onClick={() => handleSelectHost(host)}
                    type="button"
                  >
                    <span className="quick-tmux-host-name">{host.name}</span>
                    {host.isLocalhost ? (
                      <span className="quick-tmux-host-detail">本机 tmux</span>
                    ) : (
                      <span className="quick-tmux-host-detail">
                        {host.username ? `${host.username}@` : ""}
                        {host.host}
                        {host.port !== 22 ? `:${host.port}` : ""}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <form className="quick-tmux-form" onSubmit={handleSubmit}>
            <div className="quick-tmux-host-pill">
              <span>{selectedHost.name}</span>
              <button
                className="quick-tmux-back"
                onClick={() => setSelectedHost(null)}
                type="button"
              >
                重新选择
              </button>
            </div>

            <label
              className="quick-tmux-label"
              htmlFor="quick-tmux-session-name"
            >
              tmux 会话名
            </label>
            <input
              ref={sessionNameRef}
              className="quick-tmux-input"
              data-testid="quick-tmux-session-name"
              id="quick-tmux-session-name"
              onChange={(event) => setSessionName(event.target.value)}
              placeholder={`默认: ${buildDefaultQuickTmuxName(selectedHost.name)}`}
              value={sessionName}
            />

            <label
              className="quick-tmux-label"
              htmlFor="quick-tmux-working-directory"
            >
              打开目录
            </label>
            <input
              className="quick-tmux-input"
              data-testid="quick-tmux-working-directory"
              id="quick-tmux-working-directory"
              onChange={(event) => setWorkingDirectory(event.target.value)}
              placeholder={selectedHost.defaultPath || "~/"}
              value={workingDirectory}
            />

            <p className="quick-tmux-message">
              未填写会话名时会自动生成，目录默认使用家目录。
            </p>

            <div className="quick-tmux-actions">
              <button
                className="drawer-btn"
                onClick={handleClose}
                type="button"
              >
                取消
              </button>
              <button
                className="drawer-btn primary"
                disabled={submitting}
                type="submit"
              >
                {submitting ? "连接中..." : "打开 tmux"}
              </button>
            </div>
          </form>
        )}

        {errorMessage && <p className="quick-tmux-error">{errorMessage}</p>}
      </div>
    </div>
  );
}
