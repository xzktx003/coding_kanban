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
import type { SelectedHost } from "./HostDropdown";

interface NewSessionDialogProps {
  open: boolean;
  host: SelectedHost | null;
  sessions: AgentSessionRecord[];
  onClose: () => void;
  onLaunched: () => void;
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
  onClose,
  onLaunched,
}: NewSessionDialogProps) {
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("copilot");
  const [newDir, setNewDir] = useState("");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("direct");
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
  const suggestionRequestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setNewKind("copilot");
      setNewDir("");
      setLaunchMode("direct");
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
    setNewDir(host?.type === "ssh" ? host.preset.defaultPath || "~/" : "");
    setLaunchMode("direct");
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
      nameInputRef.current?.focus();
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
  }, [host, newDir, open]);

  if (!open || !host) {
    return null;
  }

  const selectedHost = host;
  const defaultHostLabel =
    selectedHost.type === "local"
      ? "local"
      : selectedHost.preset.host || selectedHost.preset.name;
  const defaultSessionName = buildDefaultSessionName({
    hostLabel: defaultHostLabel,
    agentKind: newKind,
    launchMode,
    existingNames: sessions.map((session) => session.displayName),
  });

  function currentSshTarget(): SshTarget | undefined {
    if (selectedHost.type !== "ssh") {
      return undefined;
    }

    return {
      host: selectedHost.preset.host,
      port: selectedHost.preset.port,
      username: selectedHost.preset.username,
      identityFile: selectedHost.preset.identityFile,
    };
  }

  const showDirectorySuggestions =
    !directoryPickerOpen &&
    directorySuggestionsEnabled &&
    directorySuggestions.length > 0;
  const directoryEntries = directoryPickerEntries.filter(isDirectoryEntry);

  const currentTargetLabel =
    selectedHost.type === "local" ? "本地" : selectedHost.preset.name;

  function getInitialDirectoryPickerPath(): string {
    const rawDir = newDir.trim();
    if (rawDir) {
      return rawDir;
    }

    if (selectedHost.type === "ssh") {
      return selectedHost.preset.defaultPath || "~/";
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
      if (selectedHost.type === "ssh") {
        const remoteWorkingDirectory =
          rawDir || selectedHost.preset.defaultPath || "~/";
        const command =
          launchMode === "tmux"
            ? buildTmuxLaunchCommand(
                newKind,
                remoteWorkingDirectory,
                name,
                tmuxSessionName ?? name,
              )
            : buildDirectLaunchCommand(newKind, remoteWorkingDirectory, name);
        const target = currentSshTarget();
        if (!target) {
          throw new Error("missing ssh target");
        }

        const remoteCommand = wrapRemoteInteractiveCommand(
          launchMode === "tmux"
            ? command
            : buildRemoteDirectLaunchCommand(
                newKind,
                remoteWorkingDirectory,
                name,
              ),
        );

        await launchSshPtyAgent({
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
        await launchPtyAgent(input);
      }

      onLaunched();
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
                直接创建
              </button>
              <button
                aria-pressed={launchMode === "tmux"}
                className={`new-session-mode-btn${launchMode === "tmux" ? " is-active" : ""}`}
                data-testid="new-session-mode-tmux"
                onClick={() => setLaunchMode("tmux")}
                type="button"
              >
                从 tmux 创建
              </button>
            </div>
          </div>

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
                  disabled={directoryPickerLoading || submitting}
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
            tmux session 名将使用当前显示名称；未填写时会自动生成唯一名称
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
