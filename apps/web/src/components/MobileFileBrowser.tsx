import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";

import type {
  AgentSessionRecord,
  FileEntry,
  FilePreviewResponse,
} from "@agent-orchestrator/shared";

import { previewFile } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { isMarkdownFileName } from "../lib/file-types";
import {
  useFileBrowser,
  type UseFileBrowserHost,
} from "../lib/use-file-browser";
import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";

interface MobileFileBrowserProps {
  session: AgentSessionRecord;
  onBack: () => void;
  backLabel?: string;
}

interface MobileFilePreviewState {
  entry: FileEntry;
  requestedOffset: number;
  loading: boolean;
  preview: FilePreviewResponse | null;
  error: string | null;
}

interface MobileFileContextMenuState {
  entry: FileEntry;
  error: string | null;
  busy: boolean;
}

interface MobileCreateMenuState {
  name: string;
  error: string | null;
  busy: boolean;
}

type MobileFilePreviewKind = "markdown" | "text" | "image" | "binary";
export type MobileMarkdownViewMode = "rendered" | "source";
const MOBILE_FILE_PREVIEW_WINDOW_BYTES = 64 * 1024;
const MOBILE_FILE_LONG_PRESS_MS = 600;
const MOBILE_FILE_LONG_PRESS_MOVE_PX = 12;

export function normalizeMobileNewEntryName(value: string): string | null {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
}

export function classifyMobileFilePreview(
  entry: FileEntry,
  preview: FilePreviewResponse,
): MobileFilePreviewKind {
  if (preview.encoding === "utf8") {
    return isMarkdownFileName(entry.name) ? "markdown" : "text";
  }
  return preview.mimeType?.startsWith("image/") ? "image" : "binary";
}

export function resolveMobileMarkdownDisplayKind(
  previewKind: MobileFilePreviewKind,
  viewMode: MobileMarkdownViewMode,
): MobileFilePreviewKind {
  return previewKind === "markdown" && viewMode === "source"
    ? "text"
    : previewKind;
}

function isDirectory(entry: FileEntry): boolean {
  return (
    entry.type === "directory" ||
    (entry.type === "symlink" && entry.symlinkTargetType === "directory")
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatMobileFilePreviewRange(
  preview: FilePreviewResponse,
): string {
  const end = Math.min(preview.size, preview.offset + preview.bytesRead);
  return `${formatFileSize(preview.offset)}–${formatFileSize(end)} / ${formatFileSize(preview.size)}`;
}

function fileKindLabel(entry: FileEntry): string {
  if (isDirectory(entry)) return "目录";
  if (entry.type === "symlink") return "链接";
  const extension = entry.name.split(".").at(-1);
  return extension && extension !== entry.name
    ? extension.slice(0, 4).toUpperCase()
    : "文件";
}

export function MobileFileBrowser({
  session,
  onBack,
  backLabel = "返回项目",
}: MobileFileBrowserProps) {
  const defaultPath = session.repositoryRoot ?? session.workingDirectory ?? "~";
  const sshHost = session.sshTarget?.host;
  const sshPort = session.sshTarget?.port;
  const sshUsername = session.sshTarget?.username;
  const sshIdentityFile = session.sshTarget?.identityFile;
  const selectedHost = useMemo<UseFileBrowserHost>(
    () =>
      sshHost
        ? {
            type: "ssh",
            preset: {
              host: sshHost,
              port: sshPort ?? 22,
              username: sshUsername,
              identityFile: sshIdentityFile,
              defaultPath,
            },
          }
        : { type: "local" },
    [defaultPath, sshHost, sshIdentityFile, sshPort, sshUsername],
  );
  const {
    currentPath,
    entries,
    loading,
    error,
    showHidden,
    setShowHidden,
    filterQuery,
    setFilterQuery,
    sshTarget,
    navigate,
    refresh,
    goHome,
    goUp,
    renameEntry,
    deleteEntries,
    downloadEntries,
    createFile,
    createFolder,
  } = useFileBrowser(selectedHost, true, {
    scopeKey: `mobile-files:${session.id}`,
    defaultPath,
  });
  const [filePreview, setFilePreview] = useState<MobileFilePreviewState | null>(
    null,
  );
  const [markdownViewMode, setMarkdownViewMode] =
    useState<MobileMarkdownViewMode>("rendered");
  const [previewControlsExpanded, setPreviewControlsExpanded] = useState(false);
  const previewRequestIdRef = useRef(0);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] =
    useState<MobileFileContextMenuState | null>(null);
  const [createMenu, setCreateMenu] = useState<MobileCreateMenuState | null>(
    null,
  );
  const createNameInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextFileClickRef = useRef(false);

  const cancelFileLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const startFileLongPress = (
    entry: FileEntry,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || event.pointerType === "mouse") return;
    cancelFileLongPress();
    longPressStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      suppressNextFileClickRef.current = true;
      setContextMenu({ entry, error: null, busy: false });
    }, MOBILE_FILE_LONG_PRESS_MS);
  };

  const moveFileLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = longPressStartRef.current;
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
        MOBILE_FILE_LONG_PRESS_MOVE_PX
    ) {
      cancelFileLongPress();
    }
  };

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    },
    [],
  );

  const loadPreviewWindow = async (entry: FileEntry, offset = 0) => {
    const requestId = ++previewRequestIdRef.current;
    setFilePreview((current) => ({
      entry,
      requestedOffset: offset,
      loading: true,
      preview: current?.entry.path === entry.path ? current.preview : null,
      error: null,
    }));
    try {
      const preview = await previewFile({
        path: entry.path,
        sshTarget,
        maxBytes: MOBILE_FILE_PREVIEW_WINDOW_BYTES,
        offset,
      });
      if (requestId !== previewRequestIdRef.current) return;
      setFilePreview({
        entry,
        requestedOffset: preview.offset,
        loading: false,
        preview,
        error: null,
      });
    } catch (caughtError) {
      if (requestId !== previewRequestIdRef.current) return;
      setFilePreview({
        entry,
        requestedOffset: offset,
        loading: false,
        preview: null,
        error:
          caughtError instanceof Error ? caughtError.message : "读取文件失败",
      });
    }
  };

  const openFile = (entry: FileEntry) => {
    setMarkdownViewMode("rendered");
    setPreviewControlsExpanded(false);
    return loadPreviewWindow(entry);
  };

  const runContextAction = async (
    action: (entry: FileEntry) => Promise<unknown>,
  ) => {
    const entry = contextMenu?.entry;
    if (!entry || contextMenu.busy) return;
    setContextMenu((current) =>
      current ? { ...current, error: null, busy: true } : current,
    );
    try {
      await action(entry);
      setContextMenu(null);
    } catch (caughtError) {
      setContextMenu((current) =>
        current
          ? {
              ...current,
              busy: false,
              error:
                caughtError instanceof Error
                  ? caughtError.message
                  : "文件操作失败",
            }
          : current,
      );
    }
  };

  const openCreateMenu = () => {
    flushSync(() => {
      setCreateMenu({ name: "", busy: false, error: null });
    });
    createNameInputRef.current?.focus({ preventScroll: true });
  };

  const runCreateAction = async (kind: "file" | "directory") => {
    if (createMenu?.busy) return;
    const name = normalizeMobileNewEntryName(createMenu?.name ?? "");
    if (!name) {
      setCreateMenu((current) =>
        current
          ? {
              ...current,
              busy: false,
              error: "名称不能为空、不能是 . 或 ..，也不能包含路径分隔符。",
            }
          : current,
      );
      createNameInputRef.current?.focus({ preventScroll: true });
      return;
    }

    setCreateMenu((current) =>
      current ? { ...current, busy: true, error: null } : current,
    );
    try {
      if (kind === "file") {
        await createFile(name);
      } else {
        await createFolder(name);
      }
      setCreateMenu(null);
    } catch (caughtError) {
      setCreateMenu((current) =>
        current
          ? {
              ...current,
              busy: false,
              error:
                caughtError instanceof Error ? caughtError.message : "新建失败",
            }
          : current,
      );
    }
  };

  useEffect(() => {
    previewContentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [filePreview?.preview?.offset, markdownViewMode]);

  if (filePreview) {
    const { entry, preview, loading: previewLoading } = filePreview;
    const previewKind = preview
      ? classifyMobileFilePreview(entry, preview)
      : null;
    const displayKind = previewKind
      ? resolveMobileMarkdownDisplayKind(previewKind, markdownViewMode)
      : null;
    return (
      <section
        aria-label="手机文件预览"
        className={`mobile-file-preview${
          previewControlsExpanded
            ? " mobile-file-preview--controls-expanded"
            : ""
        }`}
      >
        <header className="mobile-file-preview-header">
          <button
            className="mobile-file-browser-control"
            onClick={() => {
              previewRequestIdRef.current += 1;
              setFilePreview(null);
            }}
            type="button"
          >
            返回文件
          </button>
          <div>
            <strong>{entry.name}</strong>
            <span>{formatFileSize(entry.size)}</span>
          </div>
          <button
            aria-controls="mobile-file-preview-controls"
            aria-expanded={previewControlsExpanded}
            aria-label={
              previewControlsExpanded ? "收起文件选项" : "展开文件选项"
            }
            className="mobile-file-browser-control"
            onClick={() => setPreviewControlsExpanded((expanded) => !expanded)}
            type="button"
          >
            {previewControlsExpanded ? "收起" : "选项"}
          </button>
        </header>
        {previewControlsExpanded && (
          <div
            aria-label="文件预览选项"
            className="mobile-file-preview-controls"
            id="mobile-file-preview-controls"
          >
            {previewKind === "markdown" && (
              <div
                aria-label="Markdown 查看方式"
                className="mobile-file-preview-mode"
                role="group"
              >
                <button
                  aria-pressed={markdownViewMode === "rendered"}
                  onClick={() => setMarkdownViewMode("rendered")}
                  type="button"
                >
                  渲染
                </button>
                <button
                  aria-pressed={markdownViewMode === "source"}
                  onClick={() => setMarkdownViewMode("source")}
                  type="button"
                >
                  源码
                </button>
              </div>
            )}
            {preview &&
              preview.encoding === "utf8" &&
              (preview.previousOffset !== null ||
                preview.nextOffset !== null) && (
                <nav
                  aria-label="文件分段导航"
                  className="mobile-file-preview-pagination"
                >
                  <button
                    disabled={previewLoading || preview.previousOffset === null}
                    onClick={() =>
                      void loadPreviewWindow(
                        entry,
                        preview.previousOffset ?? preview.offset,
                      )
                    }
                    type="button"
                  >
                    上一段
                  </button>
                  <div>
                    <strong>{formatMobileFilePreviewRange(preview)}</strong>
                    <span>仅保留当前段，切换后释放旧段</span>
                  </div>
                  <button
                    disabled={previewLoading || preview.nextOffset === null}
                    onClick={() =>
                      void loadPreviewWindow(
                        entry,
                        preview.nextOffset ?? preview.offset,
                      )
                    }
                    type="button"
                  >
                    下一段
                  </button>
                </nav>
              )}
            {preview?.truncated && preview.encoding === "binary" && (
              <div className="mobile-file-preview-truncated">
                二进制文件较大，预览已按资源上限截断。
              </div>
            )}
            <div className="mobile-file-preview-path-row">
              <code className="mobile-file-preview-path">{entry.path}</code>
              <button
                className="mobile-file-browser-control"
                onClick={() => void copyTextToClipboard(entry.path)}
                type="button"
              >
                复制路径
              </button>
            </div>
          </div>
        )}
        <div className="mobile-file-preview-content" ref={previewContentRef}>
          {previewLoading ? (
            <div className="mobile-file-browser-state">正在读取文件...</div>
          ) : filePreview.error ? (
            <div className="mobile-file-browser-state" role="alert">
              <strong>文件读取失败</strong>
              <span>{filePreview.error}</span>
              <button
                onClick={() =>
                  void loadPreviewWindow(entry, filePreview.requestedOffset)
                }
                type="button"
              >
                重试
              </button>
            </div>
          ) : preview && displayKind === "markdown" ? (
            <LazyMarkdownContent
              className="mobile-file-preview-markdown"
              content={preview.content}
              fallbackClassName="mobile-file-preview-loading"
              fallbackTestId="mobile-markdown-loading"
              fallbackText="正在渲染 Markdown..."
              resourceContext={{
                documentPath: entry.path,
                rootPath: defaultPath,
                sshTarget,
              }}
              testId="mobile-markdown-preview"
            />
          ) : preview && displayKind === "text" ? (
            <pre>{preview.content}</pre>
          ) : preview && displayKind === "image" ? (
            <img
              alt={entry.name}
              src={`data:${preview.mimeType};base64,${preview.content}`}
            />
          ) : (
            <div className="mobile-file-browser-state">
              <strong>该文件不支持文本预览</strong>
              <span>
                {preview?.mimeType ?? "未知类型"} · {formatFileSize(entry.size)}
              </span>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="手机文件系统" className="mobile-file-browser">
      <header className="mobile-file-browser-header">
        <button
          className="mobile-file-browser-control"
          onClick={onBack}
          type="button"
        >
          {backLabel}
        </button>
        <div>
          <strong>{session.projectName ?? session.displayName}</strong>
          <span>{session.sshTarget ? session.sshTarget.host : "本机文件"}</span>
        </div>
      </header>

      <div className="mobile-file-browser-pathbar">
        <code title={currentPath}>{currentPath}</code>
        <div>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void goHome()}
            type="button"
          >
            主目录
          </button>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void goUp()}
            type="button"
          >
            上一级
          </button>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            刷新
          </button>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={openCreateMenu}
            type="button"
          >
            新建
          </button>
        </div>
      </div>

      <div className="mobile-file-browser-filters">
        <input
          aria-label="筛选文件"
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="搜索当前目录"
          type="search"
          value={filterQuery}
        />
        <label>
          <input
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
            type="checkbox"
          />
          显示隐藏文件
        </label>
      </div>

      <div aria-busy={loading} className="mobile-file-list">
        {loading && entries.length === 0 ? (
          <div className="mobile-file-browser-state">正在读取目录...</div>
        ) : error ? (
          <div className="mobile-file-browser-state" role="alert">
            <strong>目录读取失败</strong>
            <span>{error}</span>
            <button onClick={() => void refresh()} type="button">
              重试
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="mobile-file-browser-state">当前目录没有文件。</div>
        ) : (
          entries.map((entry) => {
            const directory = isDirectory(entry);
            return (
              <button
                className="mobile-file-entry"
                key={entry.path}
                onClick={(event) => {
                  if (suppressNextFileClickRef.current) {
                    suppressNextFileClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  directory ? void navigate(entry.path) : void openFile(entry);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  cancelFileLongPress();
                  setContextMenu({ entry, error: null, busy: false });
                }}
                onPointerCancel={cancelFileLongPress}
                onPointerDown={(event) => startFileLongPress(entry, event)}
                onPointerLeave={cancelFileLongPress}
                onPointerMove={moveFileLongPress}
                onPointerUp={cancelFileLongPress}
                type="button"
              >
                <span className="mobile-file-entry-kind">
                  {fileKindLabel(entry)}
                </span>
                <span className="mobile-file-entry-identity">
                  <strong>{entry.name}</strong>
                  <small>
                    {directory
                      ? new Date(entry.modifiedAt).toLocaleString("zh-CN")
                      : `${formatFileSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString("zh-CN")}`}
                  </small>
                </span>
                <span className="mobile-file-entry-action">
                  {directory ? "进入" : "预览"}
                </span>
              </button>
            );
          })
        )}
      </div>
      {createMenu && (
        <div
          className="mobile-file-context-backdrop"
          onClick={() => !createMenu.busy && setCreateMenu(null)}
          role="presentation"
        >
          <div
            aria-label="新建文件或文件夹"
            aria-modal="true"
            className="mobile-file-context-menu"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <strong>在当前目录新建</strong>
              <code>{currentPath}</code>
            </header>
            <input
              aria-label="新文件或文件夹名称"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              className="mobile-file-create-input"
              disabled={createMenu.busy}
              onChange={(event) =>
                setCreateMenu((current) =>
                  current
                    ? { ...current, name: event.target.value, error: null }
                    : current,
                )
              }
              placeholder="输入名称，例如 notes.md"
              ref={createNameInputRef}
              spellCheck={false}
              type="text"
              value={createMenu.name}
            />
            {createMenu.error && <div role="alert">{createMenu.error}</div>}
            <div className="mobile-file-context-actions">
              <button
                disabled={createMenu.busy}
                onClick={() => void runCreateAction("file")}
                type="button"
              >
                新建文件
              </button>
              <button
                disabled={createMenu.busy}
                onClick={() => void runCreateAction("directory")}
                type="button"
              >
                新建文件夹
              </button>
              <button
                disabled={createMenu.busy}
                onClick={() => setCreateMenu(null)}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {contextMenu && (
        <div
          className="mobile-file-context-backdrop"
          onClick={() => setContextMenu(null)}
          role="presentation"
        >
          <div
            aria-label="文件操作菜单"
            aria-modal="true"
            className="mobile-file-context-menu"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <strong>{contextMenu.entry.name}</strong>
              <code>{contextMenu.entry.path}</code>
            </header>
            {contextMenu.error && <div role="alert">{contextMenu.error}</div>}
            <div className="mobile-file-context-actions">
              <button
                disabled={contextMenu.busy}
                onClick={() => {
                  const entry = contextMenu.entry;
                  setContextMenu(null);
                  isDirectory(entry)
                    ? void navigate(entry.path)
                    : void openFile(entry);
                }}
                type="button"
              >
                {isDirectory(contextMenu.entry) ? "进入目录" : "预览文件"}
              </button>
              <button
                disabled={contextMenu.busy}
                onClick={() =>
                  void runContextAction((entry) =>
                    downloadEntries([entry.path]),
                  )
                }
                type="button"
              >
                下载
              </button>
              <button
                disabled={contextMenu.busy}
                onClick={() => {
                  const entry = contextMenu.entry;
                  const nextName = window.prompt("重命名", entry.name)?.trim();
                  if (!nextName || nextName === entry.name) return;
                  void runContextAction(() =>
                    renameEntry(entry.path, nextName),
                  );
                }}
                type="button"
              >
                重命名
              </button>
              <button
                disabled={contextMenu.busy}
                onClick={() => {
                  const entry = contextMenu.entry;
                  if (!window.confirm(`删除 ${entry.name}？此操作无法撤销。`)) {
                    return;
                  }
                  void runContextAction(() => deleteEntries([entry.path]));
                }}
                type="button"
              >
                删除
              </button>
              <button
                disabled={contextMenu.busy}
                onClick={() =>
                  void runContextAction((entry) =>
                    copyTextToClipboard(entry.path),
                  )
                }
                type="button"
              >
                复制路径
              </button>
              <button
                disabled={contextMenu.busy}
                onClick={() => setContextMenu(null)}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
