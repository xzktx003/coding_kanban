import { useEffect, useRef, useState } from "react";

import type {
  AgentSessionRecord,
  FileEntry,
  LaunchLocalAgentInput,
  SshTarget,
} from "@agent-orchestrator/shared";

import {
  fileOperation,
  getDirectorySuggestions,
  launchPtyAgent,
  launchSshPtyAgent,
  listFiles,
} from "../lib/api";
import type { LaunchMode } from "../lib/session-matching";
import {
  buildDirectLaunchCommand,
  buildRemoteDirectLaunchCommand,
  buildTmuxLaunchCommand,
  wrapRemoteInteractiveCommand,
} from "../lib/session-matching";
import { formatSessionLaunchError } from "../lib/session-launch-error";
import { buildDefaultSessionName } from "../lib/session-naming";
import type { NewSessionHost } from "./HostDropdown";
import {
  UNGROUPED_SESSION_GROUP_ID,
  type SessionGroupState,
} from "../lib/session-groups";

interface NewSessionDialogProps {
  open: boolean;
  host: NewSessionHost | null;
  sessions: AgentSessionRecord[];
  sessionGroups?: SessionGroupState;
  onClose: () => void;
  onLaunched: (session: AgentSessionRecord, groupId: string | null) => void;
}

export interface ManualSshConnectionInput {
  host: string;
  port: string;
  username: string;
  identityFile: string;
}

export function buildManualSshTarget(
  input: ManualSshConnectionInput,
): SshTarget {
  const host = input.host.trim();
  if (!host) {
    throw new Error("请输入 SSH 主机地址");
  }

  const rawPort = input.port.trim() || "22";
  if (!/^\d+$/.test(rawPort)) {
    throw new Error("SSH 端口必须是 1 到 65535 之间的整数");
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSH 端口必须是 1 到 65535 之间的整数");
  }

  const username = input.username.trim();
  const identityFile = input.identityFile.trim();
  return {
    host,
    port,
    ...(username ? { username } : {}),
    ...(identityFile ? { identityFile } : {}),
  };
}

export function joinDirectoryPath(basePath: string, name: string): string {
  const cleanName = name.replace(/^\/+|\/+$/g, "");
  if (!basePath || basePath === "/") {
    return `/${cleanName}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${cleanName}`;
}

export function getParentDirectoryPath(inputPath: string): string {
  if (!inputPath || inputPath === "/" || inputPath === "~") {
    return inputPath || "/";
  }

  const trimmed = inputPath.replace(/\/+$/, "");
  if (trimmed === "~") {
    return "~";
  }

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return trimmed.startsWith("/") ? "/" : (parts[0] ?? "/");
  }

  return `${trimmed.startsWith("/") ? "/" : ""}${parts.slice(0, -1).join("/")}`;
}

function isDirectoryEntry(entry: FileEntry): boolean {
  return entry.type === "directory" || entry.symlinkTargetType === "directory";
}

export function NewSessionDialog({
  open,
  host,
  sessions,
  sessionGroups = { groups: [], assignments: {}, collapsedGroupIds: [] },
  onClose,
  onLaunched,
}: NewSessionDialogProps) {
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("copilot");
  const [newDir, setNewDir] = useState("");
  const [manualSshHost, setManualSshHost] = useState("");
  const [manualSshPort, setManualSshPort] = useState("22");
  const [manualSshUsername, setManualSshUsername] = useState("");
  const [manualSshIdentityFile, setManualSshIdentityFile] = useState("");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("tmux");
  const [selectedGroupId, setSelectedGroupId] = useState(
    UNGROUPED_SESSION_GROUP_ID,
  );
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>(
    [],
  );
  const [directorySuggestionsEnabled, setDirectorySuggestionsEnabled] =
    useState(false);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directoryPickerPath, setDirectoryPickerPath] = useState("");
  const [directoryPickerEntries, setDirectoryPickerEntries] = useState<
    FileEntry[]
  >([]);
  const [directoryPickerLoading, setDirectoryPickerLoading] = useState(false);
  const [directoryPickerError, setDirectoryPickerError] = useState<
    string | null
  >(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const manualSshHostInputRef = useRef<HTMLInputElement>(null);
  const suggestionRequestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setNewKind("copilot");
      setNewDir("");
      setManualSshHost("");
      setManualSshPort("22");
      setManualSshUsername("");
      setManualSshIdentityFile("");
      setLaunchMode("tmux");
      setSelectedGroupId(UNGROUPED_SESSION_GROUP_ID);
      setSubmitting(false);
      setStatusMessage(null);
      setDirectorySuggestions([]);
      setDirectorySuggestionsEnabled(false);
      setDirectoryPickerOpen(false);
      setDirectoryPickerPath("");
      setDirectoryPickerEntries([]);
      setDirectoryPickerLoading(false);
      setDirectoryPickerError(null);
      setNewFolderName("");
      setCreatingFolder(false);
      return;
    }

    setNewName("");
    setNewKind("copilot");
    setNewDir(
      host?.type === "ssh"
        ? host.preset.defaultPath || "~/"
        : host?.type === "ssh-manual"
          ? "~/"
          : "",
    );
    setManualSshHost("");
    setManualSshPort("22");
    setManualSshUsername("");
    setManualSshIdentityFile("");
    setLaunchMode("tmux");
    setSelectedGroupId(UNGROUPED_SESSION_GROUP_ID);
    setSubmitting(false);
    setStatusMessage(null);
    setDirectorySuggestions([]);
    setDirectorySuggestionsEnabled(false);
    setDirectoryPickerOpen(false);
    setDirectoryPickerPath("");
    setDirectoryPickerEntries([]);
    setDirectoryPickerLoading(false);
    setDirectoryPickerError(null);
    setNewFolderName("");
    setCreatingFolder(false);
  }, [host, open]);

  useEffect(() => {
    if (!open || !host) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (host.type === "ssh-manual") {
        manualSshHostInputRef.current?.focus();
      } else {
        nameInputRef.current?.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [host, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting) {
        return;
      }

      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, submitting]);

  useEffect(() => {
    if (!open || !host) {
      return;
    }

    const prefix = newDir.trim();
    if (!prefix) {
      setDirectorySuggestions([]);
      setDirectorySuggestionsEnabled(false);
      return;
    }

    const requestId = suggestionRequestRef.current + 1;
    suggestionRequestRef.current = requestId;

    const timerId = window.setTimeout(() => {
      const sshTarget = currentSshTarget();
      if (selectedHost.type === "ssh-manual" && !sshTarget) {
        setDirectorySuggestionsEnabled(false);
        setDirectorySuggestions([]);
        return;
      }
      getDirectorySuggestions({
        prefix,
        ...(sshTarget ? { sshTarget } : {}),
      })
        .then((result) => {
          if (suggestionRequestRef.current !== requestId) {
            return;
          }

          setDirectorySuggestionsEnabled(result.enabled);
          setDirectorySuggestions(result.suggestions);
        })
        .catch(() => {
          if (suggestionRequestRef.current !== requestId) {
            return;
          }

          setDirectorySuggestionsEnabled(false);
          setDirectorySuggestions([]);
        });
    }, 160);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    host,
    manualSshHost,
    manualSshIdentityFile,
    manualSshPort,
    manualSshUsername,
    newDir,
    open,
  ]);

  if (!open || !host) {
    return null;
  }

  const selectedHost = host;
  const defaultHostLabel =
    selectedHost.type === "local"
      ? "local"
      : selectedHost.type === "ssh"
        ? selectedHost.preset.host || selectedHost.preset.name
        : manualSshHost.trim() || "ssh";
  const defaultSessionName = buildDefaultSessionName({
    hostLabel: defaultHostLabel,
    agentKind: newKind,
    launchMode,
    existingNames: sessions.map((session) => session.displayName),
  });

  function currentSshTarget(): SshTarget | undefined {
    if (selectedHost.type === "local") {
      return undefined;
    }

    if (selectedHost.type === "ssh") {
      return {
        host: selectedHost.preset.host,
        port: selectedHost.preset.port,
        username: selectedHost.preset.username,
        identityFile: selectedHost.preset.identityFile,
      };
    }

    try {
      return buildManualSshTarget({
        host: manualSshHost,
        port: manualSshPort,
        username: manualSshUsername,
        identityFile: manualSshIdentityFile,
      });
    } catch {
      return undefined;
    }
  }

  function requireCurrentSshTarget(): SshTarget {
    if (selectedHost.type === "ssh") {
      return {
        host: selectedHost.preset.host,
        port: selectedHost.preset.port,
        username: selectedHost.preset.username,
        identityFile: selectedHost.preset.identityFile,
      };
    }

    if (selectedHost.type === "ssh-manual") {
      return buildManualSshTarget({
        host: manualSshHost,
        port: manualSshPort,
        username: manualSshUsername,
        identityFile: manualSshIdentityFile,
      });
    }

    throw new Error("当前目标不是 SSH 主机");
  }

  const showDirectorySuggestions =
    !directoryPickerOpen &&
    directorySuggestionsEnabled &&
    directorySuggestions.length > 0;
  const directoryEntries = directoryPickerEntries.filter(isDirectoryEntry);

  const currentTargetLabel =
    selectedHost.type === "local"
      ? "本地"
      : selectedHost.type === "ssh"
        ? selectedHost.preset.name
        : manualSshHost.trim() || "新增 SSH 连接";

  function getInitialDirectoryPickerPath(): string {
    const rawDir = newDir.trim();
    if (rawDir) {
      return rawDir;
    }

    if (selectedHost.type === "ssh") {
      return selectedHost.preset.defaultPath || "~/";
    }

    if (selectedHost.type === "ssh-manual") {
      return "~/";
    }

    return "";
  }

  async function loadDirectoryPickerPath(pathValue: string) {
    const requestId = directoryRequestRef.current + 1;
    directoryRequestRef.current = requestId;
    setDirectoryPickerLoading(true);
    setDirectoryPickerError(null);

    try {
      const sshTarget = currentSshTarget();
      const result = await listFiles({
        path: pathValue,
        ...(sshTarget ? { sshTarget } : {}),
      });

      if (directoryRequestRef.current !== requestId) {
        return;
      }

      setDirectoryPickerPath(result.path);
      setDirectoryPickerEntries(result.entries);
    } catch (error) {
      if (directoryRequestRef.current !== requestId) {
        return;
      }

      setDirectoryPickerError(
        error instanceof Error ? error.message : "目录加载失败",
      );
      setDirectoryPickerEntries([]);
    } finally {
      if (directoryRequestRef.current === requestId) {
        setDirectoryPickerLoading(false);
      }
    }
  }

  function openDirectoryPicker() {
    setDirectoryPickerOpen(true);
    setNewFolderName("");
    void loadDirectoryPickerPath(getInitialDirectoryPickerPath());
  }

  function selectWorkingDirectory(pathValue: string) {
    setNewDir(pathValue);
    setDirectoryPickerOpen(false);
    setDirectoryPickerError(null);
    setNewFolderName("");
  }

  async function createFolderInCurrentDirectory() {
    if (creatingFolder || !directoryPickerPath.trim()) {
      return;
    }

    const nextName = newFolderName.trim();
    if (!nextName) {
      setDirectoryPickerError("请输入文件夹名称");
      return;
    }

    if (nextName.includes("/") || nextName.includes("\\")) {
      setDirectoryPickerError("文件夹名称不能包含路径分隔符");
      return;
    }

    setCreatingFolder(true);
    setDirectoryPickerError(null);

    try {
      const sshTarget = currentSshTarget();
      const createdPath = joinDirectoryPath(directoryPickerPath, nextName);
      const result = await fileOperation({
        operation: "mkdir",
        path: createdPath,
        ...(sshTarget ? { sshTarget } : {}),
      });
      await loadDirectoryPickerPath(directoryPickerPath);
      selectWorkingDirectory(result.path ?? createdPath);
    } catch (error) {
      setDirectoryPickerError(
        error instanceof Error ? error.message : "新建文件夹失败",
      );
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleCreate() {
    if (submitting) {
      return;
    }

    const rawDir = newDir.trim();
    const name = newName.trim() || defaultSessionName;
    const hasExplicitLocalDir =
      selectedHost.type === "local" && rawDir.length > 0;
    const localWorkingDirectory = hasExplicitLocalDir ? rawDir : undefined;
    const tmuxSessionName = launchMode === "tmux" ? name : undefined;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      let launchedSession: AgentSessionRecord;
      if (selectedHost.type !== "local") {
        const remoteWorkingDirectory =
          rawDir ||
          (selectedHost.type === "ssh"
            ? selectedHost.preset.defaultPath
            : "~/") ||
          "~/";
        const command =
          launchMode === "tmux"
            ? buildTmuxLaunchCommand(
                newKind,
                remoteWorkingDirectory,
                name,
                tmuxSessionName ?? name,
              )
            : buildDirectLaunchCommand(newKind, remoteWorkingDirectory, name);
        const target = requireCurrentSshTarget();

        const remoteCommand = wrapRemoteInteractiveCommand(
          launchMode === "tmux"
            ? command
            : buildRemoteDirectLaunchCommand(
                newKind,
                remoteWorkingDirectory,
                name,
              ),
        );

        launchedSession = await launchSshPtyAgent({
          workspaceId: "default",
          displayName: name,
          agentKind: newKind,
          sshTarget: target,
          remoteCommand,
          workingDirectory: remoteWorkingDirectory,
          tmuxSessionName,
        });
      } else {
        const command =
          launchMode === "tmux"
            ? buildTmuxLaunchCommand(
                newKind,
                localWorkingDirectory ?? ".",
                name,
                tmuxSessionName ?? name,
              )
            : buildDirectLaunchCommand(
                newKind,
                localWorkingDirectory ?? ".",
                name,
              );
        const input: LaunchLocalAgentInput = {
          workspaceId: "default",
          displayName: name,
          agentKind: newKind,
          command,
          workingDirectory: localWorkingDirectory,
          tmuxSessionName,
        };
        launchedSession = await launchPtyAgent(input);
      }

      onLaunched(
        launchedSession,
        selectedGroupId === UNGROUPED_SESSION_GROUP_ID ? null : selectedGroupId,
      );
      onClose();
    } catch (error) {
      setStatusMessage(formatSessionLaunchError(error, name));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="new-session-backdrop"
      onMouseDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const shouldClose =
          !submitting &&
          backdropPointerDownRef.current &&
          event.target === event.currentTarget;
        backdropPointerDownRef.current = false;

        if (shouldClose) {
          onClose();
        }
      }}
    >
      <div
        aria-modal="true"
        className="new-session-dialog"
        data-testid="new-session-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="new-session-header">
          <div>
            <p className="new-session-kicker">创建</p>
            <h2 className="new-session-title">新建会话</h2>
          </div>
          <button
            className="new-session-close"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="new-session-target-row">
          <p
            className="new-session-message"
            data-testid="new-session-current-host"
          >
            当前目标: {currentTargetLabel}
          </p>
        </div>

        {selectedHost.type === "ssh-manual" && (
          <section
            aria-label="SSH 连接信息"
            className="new-session-ssh-connection"
            data-testid="new-session-ssh-connection"
          >
            <div className="new-session-ssh-heading">
              <div>
                <span className="new-session-label">SSH 连接</span>
                <p className="new-session-message">
                  使用本机 SSH 配置、ssh-agent 或私钥文件认证
                </p>
              </div>
              <span className="new-session-ssh-badge">仅本次会话</span>
            </div>
            <div className="new-session-ssh-grid">
              <label className="new-session-field new-session-ssh-host-field">
                <span className="new-session-label">主机地址 *</span>
                <input
                  ref={manualSshHostInputRef}
                  autoComplete="off"
                  className="drawer-input"
                  data-testid="new-session-ssh-host"
                  onChange={(event) => setManualSshHost(event.target.value)}
                  placeholder="IP、域名或 SSH Host 别名"
                  value={manualSshHost}
                />
              </label>
              <label className="new-session-field">
                <span className="new-session-label">端口</span>
                <input
                  className="drawer-input"
                  data-testid="new-session-ssh-port"
                  inputMode="numeric"
                  max={65_535}
                  min={1}
                  onChange={(event) => setManualSshPort(event.target.value)}
                  type="number"
                  value={manualSshPort}
                />
              </label>
              <label className="new-session-field">
                <span className="new-session-label">用户名</span>
                <input
                  autoComplete="username"
                  className="drawer-input"
                  data-testid="new-session-ssh-username"
                  onChange={(event) => setManualSshUsername(event.target.value)}
                  placeholder="可留空，沿用 SSH 配置"
                  value={manualSshUsername}
                />
              </label>
              <label className="new-session-field new-session-ssh-identity-field">
                <span className="new-session-label">本机私钥路径</span>
                <input
                  autoComplete="off"
                  className="drawer-input"
                  data-testid="new-session-ssh-identity-file"
                  onChange={(event) =>
                    setManualSshIdentityFile(event.target.value)
                  }
                  placeholder="可留空，例如 /home/user/.ssh/id_ed25519"
                  value={manualSshIdentityFile}
                />
              </label>
            </div>
          </section>
        )}

        <div
          className="new-session-grid"
          data-testid="new-session-details-step"
        >
          <label className="new-session-field new-session-field--wide">
            <span className="new-session-label">显示名称</span>
            <input
              ref={nameInputRef}
              className="drawer-input"
              data-testid="new-session-name"
              onChange={(event) => setNewName(event.target.value)}
              placeholder={`默认: ${defaultSessionName}`}
              value={newName}
            />
          </label>

          <fieldset
            className="new-session-field new-session-agent-field"
            data-testid="new-session-kind"
          >
            <legend className="new-session-label">Agent</legend>
            <div className="new-session-mode-toggle new-session-agent-toggle">
              {["copilot", "codex", "claude", "shell"].map((kind) => (
                <label
                  key={kind}
                  className={`new-session-mode-btn new-session-agent-btn${newKind === kind ? " is-active" : ""}`}
                  data-testid={`new-session-kind-${kind}`}
                >
                  <input
                    checked={newKind === kind}
                    className="new-session-agent-input"
                    name="new-session-agent"
                    onChange={() => setNewKind(kind)}
                    type="radio"
                    value={kind}
                  />
                  <span>{kind}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="new-session-field">
            <span className="new-session-label">启动方式</span>
            <div className="new-session-mode-toggle">
              <button
                aria-pressed={launchMode === "direct"}
                className={`new-session-mode-btn${launchMode === "direct" ? " is-active" : ""}`}
                data-testid="new-session-mode-direct"
                onClick={() => setLaunchMode("direct")}
                type="button"
              >
                直接进程
              </button>
              <button
                aria-pressed={launchMode === "tmux"}
                className={`new-session-mode-btn${launchMode === "tmux" ? " is-active" : ""}`}
                data-testid="new-session-mode-tmux"
                onClick={() => setLaunchMode("tmux")}
                type="button"
              >
                受管 tmux
              </button>
            </div>
          </div>

          <label className="new-session-field">
            <span className="new-session-label">会话分组</span>
            <select
              className="drawer-input"
              data-testid="new-session-group"
              disabled={submitting}
              onChange={(event) => setSelectedGroupId(event.target.value)}
              value={selectedGroupId}
            >
              <option value={UNGROUPED_SESSION_GROUP_ID}>未分组</option>
              {sessionGroups.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="new-session-field new-session-field--wide">
            <span className="new-session-label">工作目录</span>
            <div className="new-session-dir-wrap">
              <div className="new-session-dir-input-row">
                <input
                  className="drawer-input"
                  data-testid="new-session-dir"
                  onChange={(event) => setNewDir(event.target.value)}
                  placeholder="工作目录 (默认 ~/ 或 SSH 默认目录)"
                  value={newDir}
                />
                <button
                  className="new-session-secondary-btn"
                  data-testid="new-session-browse-dir"
                  disabled={
                    directoryPickerLoading ||
                    submitting ||
                    (selectedHost.type === "ssh-manual" && !currentSshTarget())
                  }
                  onClick={openDirectoryPicker}
                  type="button"
                >
                  选择
                </button>
              </div>
              {showDirectorySuggestions && (
                <div
                  className="directory-suggestions"
                  data-testid="directory-suggestions"
                >
                  {directorySuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      className="directory-suggestion-item"
                      data-testid={`directory-suggestion-item-${index}`}
                      onClick={() => setNewDir(suggestion)}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
        </div>

        {directoryPickerOpen && (
          <div
            className="new-session-directory-picker"
            data-testid="new-session-directory-picker"
          >
            <div className="new-session-directory-picker-header">
              <div className="new-session-directory-current-wrap">
                <span className="new-session-label">当前文件夹</span>
                <span
                  className="new-session-directory-current"
                  data-testid="new-session-directory-current"
                >
                  {directoryPickerPath || "加载中..."}
                </span>
              </div>
              <button
                className="new-session-close"
                disabled={directoryPickerLoading || creatingFolder}
                onClick={() => setDirectoryPickerOpen(false)}
                type="button"
              >
                收起
              </button>
            </div>

            <div className="new-session-directory-toolbar">
              <button
                className="new-session-secondary-btn"
                disabled={
                  directoryPickerLoading ||
                  creatingFolder ||
                  !directoryPickerPath.trim() ||
                  directoryPickerPath === "/" ||
                  directoryPickerPath === "~"
                }
                onClick={() =>
                  void loadDirectoryPickerPath(
                    getParentDirectoryPath(directoryPickerPath),
                  )
                }
                type="button"
              >
                上级
              </button>
              <button
                className="new-session-secondary-btn"
                disabled={
                  directoryPickerLoading ||
                  creatingFolder ||
                  !directoryPickerPath.trim()
                }
                onClick={() => selectWorkingDirectory(directoryPickerPath)}
                type="button"
              >
                使用当前文件夹
              </button>
            </div>

            <div className="new-session-create-folder-row">
              <input
                className="drawer-input"
                data-testid="new-session-new-folder-name"
                disabled={creatingFolder}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createFolderInCurrentDirectory();
                  }
                }}
                placeholder="在当前文件夹下新建"
                value={newFolderName}
              />
              <button
                className="new-session-secondary-btn"
                data-testid="new-session-create-folder"
                disabled={
                  creatingFolder ||
                  directoryPickerLoading ||
                  !directoryPickerPath.trim()
                }
                onClick={() => void createFolderInCurrentDirectory()}
                type="button"
              >
                {creatingFolder ? "新建中..." : "新建文件夹"}
              </button>
            </div>

            {directoryPickerError && (
              <p className="new-session-error">{directoryPickerError}</p>
            )}

            <div className="new-session-directory-list">
              {directoryPickerLoading ? (
                <p className="new-session-message">正在加载目录...</p>
              ) : directoryEntries.length > 0 ? (
                directoryEntries.map((entry) => (
                  <button
                    key={entry.path}
                    className="new-session-directory-item"
                    onClick={() => void loadDirectoryPickerPath(entry.path)}
                    type="button"
                  >
                    <span className="new-session-directory-name">
                      {entry.name}
                    </span>
                    <span className="new-session-directory-path">
                      {entry.path}
                    </span>
                  </button>
                ))
              ) : (
                <p className="new-session-message">当前文件夹下没有子文件夹</p>
              )}
            </div>
          </div>
        )}

        {launchMode === "tmux" && (
          <p
            className="new-session-message"
            data-testid="new-session-tmux-note"
          >
            推荐模式：更新或重启看板后，可重新连接仍在运行的 tmux 会话
          </p>
        )}
        {launchMode === "direct" && (
          <p className="new-session-message">
            direct 进程会随后端退出；更新后只能显式重新启动，无法保留原 PTY
          </p>
        )}

        {statusMessage && <p className="new-session-error">{statusMessage}</p>}

        <div className="new-session-actions">
          <button
            className="drawer-btn"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="drawer-btn primary"
            data-testid="create-session"
            disabled={submitting}
            onClick={handleCreate}
            type="button"
          >
            {submitting ? "创建中..." : "创建会话"}
          </button>
        </div>
      </div>
    </div>
  );
}
