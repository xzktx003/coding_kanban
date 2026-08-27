import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type {
  FileEntry,
  FilePreviewResponse,
} from "@agent-orchestrator/shared";

import { previewFile } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { isMarkdownFileName } from "../lib/file-types";
import {
  loadMarkdownPreviewWindow,
  type MarkdownPreviewWindow,
} from "../lib/markdown-preview-window";
import { useFileBrowser, type SortKey } from "../lib/use-file-browser";

import { HostDropdown, type SelectedHost } from "./HostDropdown";
import type { MarkdownPreviewMode } from "./MarkdownFilePreview";

const LazyMarkdownFilePreview = lazy(() =>
  import("./MarkdownFilePreview").then((module) => ({
    default: module.MarkdownFilePreview,
  })),
);

interface FileBrowserDrawerProps {
  open: boolean;
  resourceRootPath?: string;
  scopeKey: string;
  defaultPath?: string;
  sshHosts: Array<{
    name: string;
    host: string;
    port: number;
    username?: string;
    identityFile?: string;
    defaultPath: string;
  }>;
  selectedHost: SelectedHost;
  onSelectHost: (host: SelectedHost) => void;
}

interface ContextMenuState {
  entry: FileEntry;
  x: number;
  y: number;
}

interface RenameState {
  path: string;
  value: string;
}

interface EditorState {
  path: string;
  content: string;
  savedContent: string;
}

export interface MarkdownEditorState {
  path: string;
  content: string;
  savedContent: string;
  mode: MarkdownPreviewMode;
}

export function createMarkdownEditorState(
  path: string,
  content: string,
): MarkdownEditorState {
  return {
    path,
    content,
    savedContent: content,
    mode: "preview",
  };
}

export function getFileBrowserPreviewGridRows(
  expanded: boolean,
  previewHeight: number,
): string {
  return expanded
    ? "minmax(0, 1fr)"
    : `minmax(80px, 1fr) 8px ${previewHeight}px`;
}

interface ChmodState {
  path: string;
  value: string;
}

type CreateEntryKind = "directory" | "file";

interface CreateEntryState {
  kind: CreateEntryKind;
  value: string;
}

type UploadChoiceKind = "file" | "folder";
type FileBrowserColumnKey =
  | "name"
  | "size"
  | "modifiedAt"
  | "owner"
  | "permissions";

type FileBrowserColumnWidths = Record<FileBrowserColumnKey, number>;

interface FileBrowserColumn {
  key: FileBrowserColumnKey;
  label: string;
  sortKey?: SortKey;
  minWidth: number;
}

const FILE_BROWSER_COLUMN_WIDTH_STORAGE_KEY = "file-browser-column-widths";
const FILE_BROWSER_COLUMNS: FileBrowserColumn[] = [
  { key: "name", label: "名称", sortKey: "name", minWidth: 120 },
  { key: "size", label: "大小", sortKey: "size", minWidth: 72 },
  {
    key: "modifiedAt",
    label: "修改时间",
    sortKey: "modifiedAt",
    minWidth: 126,
  },
  { key: "owner", label: "Owner", sortKey: "owner", minWidth: 72 },
  { key: "permissions", label: "权限", sortKey: "permissions", minWidth: 92 },
];
const DEFAULT_FILE_BROWSER_COLUMN_WIDTHS: FileBrowserColumnWidths = {
  name: 260,
  size: 96,
  modifiedAt: 168,
  owner: 96,
  permissions: 116,
};

const DEFAULT_CREATE_ENTRY_NAMES: Record<CreateEntryKind, string> = {
  directory: "新建文件夹",
  file: "新建文件.txt",
};

function getCreateEntryLabel(kind: CreateEntryKind): string {
  return kind === "directory" ? "文件夹" : "文件";
}

function getFileIcon(entry: FileEntry): string {
  if (entry.type === "directory") {
    return "📁";
  }
  if (entry.type === "symlink" && entry.symlinkTargetType === "directory") {
    return "🔗📁";
  }

  const lower = entry.name.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(lower)) {
    return "🖼";
  }
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|rb|sh|bash)$/.test(lower)) {
    return "🔧";
  }
  if (/\.(txt|md|log|json|yaml|yml)$/.test(lower)) {
    return "📄";
  }
  if (/\.(zip|tar|gz|rar|7z)$/.test(lower)) {
    return "📦";
  }
  if (/\.(app|exe|bin)$/.test(lower)) {
    return "⚙️";
  }
  return "📋";
}

export { isMarkdownFileName } from "../lib/file-types";

function buildBreadcrumbs(
  pathValue: string,
): Array<{ label: string; path: string }> {
  if (!pathValue) {
    return [{ label: "Home", path: "" }];
  }

  const absolute = pathValue.startsWith("/");
  const segments = pathValue.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ label: "/", path: "/" }];
  }

  return segments.map((segment, index) => ({
    label: segment,
    path: `${absolute ? "/" : ""}${segments.slice(0, index + 1).join("/")}`,
  }));
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatMarkdownWindowRange(window: MarkdownPreviewWindow): string {
  const end = Math.min(window.size, window.offset + window.bytesRead);
  return `${formatSize(window.offset)}–${formatSize(end)} / ${formatSize(window.size)} · 仅保留当前段`;
}

function toModeFromPermissions(permissions: string): string {
  const symbols = permissions.slice(1).split("");
  const groups = [
    symbols.slice(0, 3),
    symbols.slice(3, 6),
    symbols.slice(6, 9),
  ];
  return groups
    .map(
      (group) =>
        (group[0] === "r" ? 4 : 0) +
        (group[1] === "w" ? 2 : 0) +
        (group[2] === "x" ? 1 : 0),
    )
    .join("");
}

function updateModeDigit(
  currentDigit: string,
  offset: number,
  enabled: boolean,
): string {
  const numeric = Number(currentDigit);
  const next = enabled ? numeric | offset : numeric & ~offset;
  return String(next);
}

function isTextPreview(
  preview: FilePreviewResponse | null,
): preview is FilePreviewResponse {
  return Boolean(preview && preview.encoding === "utf8");
}

function clampFileBrowserColumnWidth(
  key: FileBrowserColumnKey,
  width: number,
): number {
  const column = FILE_BROWSER_COLUMNS.find(
    (candidate) => candidate.key === key,
  );
  const minWidth = column?.minWidth ?? 72;
  if (!Number.isFinite(width)) {
    return DEFAULT_FILE_BROWSER_COLUMN_WIDTHS[key];
  }

  return Math.max(minWidth, Math.min(520, Math.round(width)));
}

function loadFileBrowserColumnWidths(): FileBrowserColumnWidths {
  try {
    const raw = localStorage.getItem(FILE_BROWSER_COLUMN_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FILE_BROWSER_COLUMN_WIDTHS;
    }

    const parsed = JSON.parse(raw) as Partial<FileBrowserColumnWidths>;
    return {
      name: clampFileBrowserColumnWidth(
        "name",
        parsed.name ?? DEFAULT_FILE_BROWSER_COLUMN_WIDTHS.name,
      ),
      size: clampFileBrowserColumnWidth(
        "size",
        parsed.size ?? DEFAULT_FILE_BROWSER_COLUMN_WIDTHS.size,
      ),
      modifiedAt: clampFileBrowserColumnWidth(
        "modifiedAt",
        parsed.modifiedAt ?? DEFAULT_FILE_BROWSER_COLUMN_WIDTHS.modifiedAt,
      ),
      owner: clampFileBrowserColumnWidth(
        "owner",
        parsed.owner ?? DEFAULT_FILE_BROWSER_COLUMN_WIDTHS.owner,
      ),
      permissions: clampFileBrowserColumnWidth(
        "permissions",
        parsed.permissions ?? DEFAULT_FILE_BROWSER_COLUMN_WIDTHS.permissions,
      ),
    };
  } catch {
    return DEFAULT_FILE_BROWSER_COLUMN_WIDTHS;
  }
}

export function FileBrowserDrawer({
  open,
  resourceRootPath,
  scopeKey,
  defaultPath,
  sshHosts,
  selectedHost,
  onSelectHost,
}: FileBrowserDrawerProps) {
  const PREVIEW_HEIGHT_STORAGE_KEY = "file-browser-preview-height";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fullscreenPreviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenPreviewExitRef = useRef<HTMLButtonElement | null>(null);
  const previewResizeRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
  const columnResizeRef = useRef<{
    key: FileBrowserColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const previewLayoutRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [createEntryState, setCreateEntryState] =
    useState<CreateEntryState | null>(null);
  const [uploadChoiceOpen, setUploadChoiceOpen] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [markdownEditorState, setMarkdownEditorState] =
    useState<MarkdownEditorState | null>(null);
  const [markdownPreviewWindow, setMarkdownPreviewWindow] =
    useState<MarkdownPreviewWindow | null>(null);
  const [markdownWindowHistory, setMarkdownWindowHistory] = useState<number[]>(
    [],
  );
  const [markdownWindowLoading, setMarkdownWindowLoading] = useState(false);
  const [markdownWindowError, setMarkdownWindowError] = useState<string | null>(
    null,
  );
  const markdownWindowRequestIdRef = useRef(0);
  const selectedFilePathRef = useRef<string | null>(null);
  const resetMarkdownWindow = useCallback(() => {
    markdownWindowRequestIdRef.current += 1;
    setMarkdownPreviewWindow(null);
    setMarkdownWindowHistory([]);
    setMarkdownWindowError(null);
    setMarkdownWindowLoading(false);
  }, []);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [savingMarkdown, setSavingMarkdown] = useState(false);
  const [, startMarkdownPreviewTransition] = useTransition();
  const [chmodState, setChmodState] = useState<ChmodState | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_HEIGHT_STORAGE_KEY);
      if (!raw) {
        return 240;
      }

      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 240;
    } catch {
      return 240;
    }
  });
  const [columnWidths, setColumnWidths] = useState(loadFileBrowserColumnWidths);
  const [pathInputValue, setPathInputValue] = useState("");

  const {
    ready,
    currentPath,
    entries,
    loading,
    error,
    showHidden,
    setShowHidden,
    filterQuery,
    setFilterQuery,
    selectedPaths,
    sortKey,
    sortDirection,
    preview,
    uploadProgress,
    uploadStatus,
    sshTarget,
    navigate,
    refresh,
    toggleSort,
    selectPath,
    setCheckboxSelection,
    createFile,
    createFolder,
    renameEntry,
    deleteEntries,
    upload,
    cancelUpload,
    saveTextFile,
    downloadEntries,
    updatePermissions,
    goHome,
    goUp,
  } = useFileBrowser(selectedHost, open, {
    scopeKey,
    defaultPath,
  });

  useEffect(() => {
    setPathInputValue(currentPath || "/");
  }, [currentPath]);

  useEffect(() => {
    setContextMenu(null);
    setPreviewExpanded(false);
    setPreviewFullscreen(false);
    selectedFilePathRef.current = null;
    resetMarkdownWindow();
  }, [resetMarkdownWindow, selectedHost]);

  useEffect(() => {
    if (!previewFullscreen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      fullscreenPreviewExitRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewFullscreen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const fullscreenPreview = fullscreenPreviewExitRef.current?.closest(
        ".file-browser-fullscreen-preview",
      );
      if (!fullscreenPreview) return;

      const focusableElements = Array.from(
        fullscreenPreview.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements.at(-1);
      if (!firstFocusable || !lastFocusable) {
        event.preventDefault();
        return;
      }

      if (
        event.shiftKey &&
        (document.activeElement === firstFocusable ||
          !fullscreenPreview.contains(document.activeElement))
      ) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      window.requestAnimationFrame(() => {
        fullscreenPreviewTriggerRef.current?.focus();
      });
    };
  }, [previewFullscreen]);

  useEffect(() => {
    function handleCloseContextMenu() {
      setContextMenu(null);
    }

    document.addEventListener("click", handleCloseContextMenu);
    return () => document.removeEventListener("click", handleCloseContextMenu);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_HEIGHT_STORAGE_KEY, String(previewHeight));
    } catch {
      // ignore storage failures
    }
  }, [previewHeight]);

  useEffect(() => {
    try {
      localStorage.setItem(
        FILE_BROWSER_COLUMN_WIDTH_STORAGE_KEY,
        JSON.stringify(columnWidths),
      );
    } catch {
      // ignore storage failures
    }
  }, [columnWidths]);

  const updateColumnWidth = useCallback((clientX: number) => {
    const resizeState = columnResizeRef.current;
    if (!resizeState) {
      return;
    }

    const delta = clientX - resizeState.startX;
    setColumnWidths((current) => ({
      ...current,
      [resizeState.key]: clampFileBrowserColumnWidth(
        resizeState.key,
        resizeState.startWidth + delta,
      ),
    }));
  }, []);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      updatePreviewHeight(event.clientY);
      updateColumnWidth(event.clientX);
    }

    function handleMouseUp() {
      previewResizeRef.current = null;
      columnResizeRef.current = null;
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [updateColumnWidth]);

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(currentPath),
    [currentPath],
  );
  const selectedEntries = entries.filter((entry) =>
    selectedPaths.includes(entry.path),
  );
  const selectedFile = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const selectedMarkdownPreview =
    selectedFile &&
    isMarkdownFileName(selectedFile.name) &&
    isTextPreview(preview) &&
    preview.path === selectedFile.path
      ? preview
      : null;
  const imagePreview =
    preview &&
    preview.encoding === "binary" &&
    preview.mimeType?.startsWith("image/")
      ? preview
      : null;
  const dragActive = dragDepth > 0;
  const fileTableStyle = useMemo(
    () =>
      ({
        "--file-browser-table-columns": FILE_BROWSER_COLUMNS.map(
          (column) => `${columnWidths[column.key]}px`,
        ).join(" "),
      }) as CSSProperties,
    [columnWidths],
  );

  useEffect(() => {
    if (!selectedFile) {
      setPreviewExpanded(false);
      setPreviewFullscreen(false);
    }
  }, [selectedFile]);

  useEffect(() => {
    const nextPath = selectedFile?.path ?? null;
    if (selectedFilePathRef.current === nextPath) return;
    selectedFilePathRef.current = nextPath;
    resetMarkdownWindow();
  }, [resetMarkdownWindow, selectedFile?.path]);

  useEffect(() => {
    if (!selectedMarkdownPreview || !selectedFile) {
      if (selectedFile && !isMarkdownFileName(selectedFile.name)) {
        setMarkdownEditorState(null);
        setMarkdownPreviewWindow(null);
        setMarkdownWindowHistory([]);
        setMarkdownWindowError(null);
      }
      return;
    }

    setMarkdownEditorState((current) => {
      if (current?.path !== selectedFile.path) {
        return createMarkdownEditorState(
          selectedFile.path,
          selectedMarkdownPreview.content,
        );
      }
      return current;
    });
    setMarkdownPreviewWindow((current) => {
      if (current?.path === selectedFile.path) return current;
      return {
        bytesRead: selectedMarkdownPreview.bytesRead,
        complete:
          selectedMarkdownPreview.offset === 0 &&
          selectedMarkdownPreview.nextOffset === null,
        content: selectedMarkdownPreview.content,
        nextOffset: selectedMarkdownPreview.nextOffset,
        offset: selectedMarkdownPreview.offset,
        path: selectedMarkdownPreview.path,
        size: selectedMarkdownPreview.size,
      };
    });
  }, [selectedFile, selectedMarkdownPreview]);

  async function loadMarkdownWindow(
    entry: FileEntry,
    offset: number,
    mode: MarkdownPreviewMode,
  ): Promise<boolean> {
    const requestId = ++markdownWindowRequestIdRef.current;
    setMarkdownWindowLoading(true);
    setMarkdownWindowError(null);
    try {
      const loadedWindow = await loadMarkdownPreviewWindow({
        path: entry.path,
        sshTarget,
        offset,
      });
      if (requestId !== markdownWindowRequestIdRef.current) return false;

      setMarkdownPreviewWindow(loadedWindow);
      setMarkdownEditorState({
        ...createMarkdownEditorState(entry.path, loadedWindow.content),
        mode: mode === "edit" && !loadedWindow.complete ? "preview" : mode,
      });
      return true;
    } catch (caughtError) {
      if (requestId === markdownWindowRequestIdRef.current) {
        setMarkdownWindowError(
          caughtError instanceof Error
            ? caughtError.message
            : "读取 Markdown 分段失败",
        );
      }
      return false;
    } finally {
      if (requestId === markdownWindowRequestIdRef.current) {
        setMarkdownWindowLoading(false);
      }
    }
  }

  async function loadNextMarkdownWindow() {
    if (
      !selectedFile ||
      !markdownPreviewWindow ||
      markdownPreviewWindow.nextOffset === null
    ) {
      return;
    }
    const currentOffset = markdownPreviewWindow.offset;
    const loaded = await loadMarkdownWindow(
      selectedFile,
      markdownPreviewWindow.nextOffset,
      markdownEditorState?.mode ?? "preview",
    );
    if (loaded) {
      setMarkdownWindowHistory((current) => [...current, currentOffset]);
    }
  }

  async function loadPreviousMarkdownWindow() {
    if (!selectedFile || markdownWindowHistory.length === 0) return;
    const previousOffset = markdownWindowHistory.at(-1)!;
    const loaded = await loadMarkdownWindow(
      selectedFile,
      previousOffset,
      markdownEditorState?.mode ?? "preview",
    );
    if (loaded) {
      setMarkdownWindowHistory((current) => current.slice(0, -1));
    }
  }

  function selectFileBrowserPath(
    pathValue: string,
    modifiers?: { additive?: boolean; range?: boolean },
  ): boolean {
    if (
      ((markdownEditorState &&
        markdownEditorState.content !== markdownEditorState.savedContent &&
        markdownEditorState.path !== pathValue) ||
        (editorState &&
          editorState.content !== editorState.savedContent &&
          editorState.path !== pathValue)) &&
      !window.confirm("当前文件有未保存修改，确定放弃并切换文件？")
    ) {
      return false;
    }

    if (selectedFilePathRef.current !== pathValue) {
      selectedFilePathRef.current = pathValue;
      resetMarkdownWindow();
    }
    selectPath(pathValue, modifiers);
    if (editorState?.path !== pathValue) {
      setEditorState(null);
    }
    return true;
  }

  async function handleSaveMarkdown() {
    if (!markdownEditorState || !markdownPreviewWindow?.complete) {
      return;
    }

    const { path, content } = markdownEditorState;
    setSavingMarkdown(true);
    try {
      await saveTextFile(path, content);
      setMarkdownEditorState((current) =>
        current?.path === path
          ? { ...current, savedContent: content }
          : current,
      );
    } finally {
      setSavingMarkdown(false);
    }
  }

  function handleMarkdownModeChange(mode: MarkdownPreviewMode) {
    if (mode !== "preview") {
      setPreviewExpanded(true);
    }

    const updateMode = () =>
      setMarkdownEditorState((current) =>
        current ? { ...current, mode } : current,
      );

    if (mode === "edit") {
      updateMode();
      return;
    }

    startMarkdownPreviewTransition(updateMode);

    if (
      mode === "split" &&
      selectedFile &&
      markdownPreviewWindow?.path === selectedFile.path &&
      !markdownPreviewWindow.complete &&
      markdownPreviewWindow.offset === 0
    ) {
      void loadMarkdownWindow(selectedFile, 0, mode).then((loaded) => {
        if (loaded) setMarkdownWindowHistory([]);
      });
    }
  }

  async function handleOpenEditor(entry: FileEntry) {
    const filePreview =
      preview && preview.path === entry.path
        ? preview
        : await previewFile({ path: entry.path, sshTarget });

    if (filePreview.encoding !== "utf8") {
      return;
    }

    if (isMarkdownFileName(entry.name)) {
      setEditorState(null);
      setPreviewExpanded(true);
      const loaded = await loadMarkdownWindow(entry, 0, "edit");
      if (loaded) setMarkdownWindowHistory([]);
      return;
    }

    setEditorState({
      path: entry.path,
      content: filePreview.content,
      savedContent: filePreview.content,
    });
    setPreviewExpanded(true);
  }

  async function handleOpenPreview(entry: FileEntry) {
    const filePreview =
      preview && preview.path === entry.path
        ? preview
        : await previewFile({ path: entry.path, sshTarget });

    if (filePreview.encoding === "utf8" && isMarkdownFileName(entry.name)) {
      setPreviewExpanded(true);
      const loaded = await loadMarkdownWindow(entry, 0, "preview");
      if (loaded) setMarkdownWindowHistory([]);
    }

    if (editorState?.path !== entry.path) {
      setEditorState(null);
    }
    setPreviewExpanded(true);
  }

  function handleReturnToFileList() {
    if (
      editorState &&
      editorState.content !== editorState.savedContent &&
      !window.confirm("当前文件有未保存修改，确定返回文件列表？")
    ) {
      return;
    }

    setEditorState(null);
    setPreviewFullscreen(false);
    setPreviewExpanded(false);
  }

  async function handleDeleteSelected() {
    if (selectedPaths.length === 0) {
      return;
    }

    if (!window.confirm(`确认删除 ${selectedPaths.length} 个条目？`)) {
      return;
    }

    await deleteEntries(selectedPaths);
  }

  if (!open) {
    return null;
  }

  function updatePreviewHeight(clientY: number) {
    const resizeState = previewResizeRef.current;
    const layout = previewLayoutRef.current;
    if (!resizeState || !layout) {
      return;
    }

    const delta = resizeState.startY - clientY;
    const maxHeight = Math.max(80, layout.clientHeight - 80);
    const nextHeight = Math.min(
      maxHeight,
      Math.max(40, resizeState.startHeight + delta),
    );
    setPreviewHeight(nextHeight);
  }

  function renderSortLabel(column: FileBrowserColumn) {
    if (!column.sortKey || sortKey !== column.sortKey) {
      return column.label;
    }

    return `${column.label} ${sortDirection === "asc" ? "↑" : "↓"}`;
  }

  function renderFilePreview(fullscreen: boolean) {
    const previewAvailable = Boolean(
      selectedFile && preview?.path === selectedFile.path,
    );
    const showMarkdownNavigation = previewExpanded || fullscreen;

    return (
      <section
        aria-label={
          fullscreen ? `${selectedFile?.name ?? "文件"} 全屏预览` : undefined
        }
        aria-modal={fullscreen ? "true" : undefined}
        className={`file-browser-preview${fullscreen ? " file-browser-fullscreen-preview" : ""}`}
        role={fullscreen ? "dialog" : undefined}
      >
        <div className="file-browser-pane-title">
          {!fullscreen && previewExpanded && (
            <button
              aria-label="返回文件列表"
              className="file-browser-inline-back"
              onClick={handleReturnToFileList}
              type="button"
            >
              ← 文件列表
            </button>
          )}
          <span>{fullscreen ? "文件预览" : "预览"}</span>
          {selectedFile && (
            <span className="file-browser-pane-hint">{selectedFile.name}</span>
          )}
          {previewAvailable && (
            <button
              aria-label={fullscreen ? "退出全屏预览" : "全屏预览"}
              className="file-browser-fullscreen-toggle"
              onClick={() => setPreviewFullscreen(!fullscreen)}
              ref={
                fullscreen
                  ? fullscreenPreviewExitRef
                  : fullscreenPreviewTriggerRef
              }
              title={fullscreen ? "退出全屏预览（Esc）" : "全屏预览文件"}
              type="button"
            >
              {fullscreen ? "退出全屏" : "全屏预览"}
            </button>
          )}
        </div>
        <div className="file-browser-preview-body">
          {selectedFile ? (
            isTextPreview(preview) ? (
              <>
                {selectedMarkdownPreview && sshTarget && (
                  <div className="file-browser-preview-actions">
                    <button
                      className="file-browser-pill"
                      onClick={() =>
                        setChmodState({
                          path: selectedFile.path,
                          value: toModeFromPermissions(
                            selectedFile.permissions,
                          ),
                        })
                      }
                      type="button"
                    >
                      chmod
                    </button>
                  </div>
                )}
                {selectedMarkdownPreview && markdownEditorState ? (
                  <Suspense
                    fallback={
                      <div className="file-browser-preview-empty">
                        正在加载 Markdown 预览...
                      </div>
                    }
                  >
                    {markdownWindowError && (
                      <div className="file-browser-inline-error" role="alert">
                        {markdownWindowError}
                      </div>
                    )}
                    <LazyMarkdownFilePreview
                      content={markdownEditorState.content}
                      dirty={
                        markdownPreviewWindow?.complete === true &&
                        markdownEditorState.content !==
                          markdownEditorState.savedContent
                      }
                      loading={markdownWindowLoading}
                      mode={markdownEditorState.mode}
                      onContentChange={(content) =>
                        setMarkdownEditorState((current) =>
                          current &&
                          markdownPreviewWindow?.complete &&
                          !markdownWindowLoading
                            ? { ...current, content }
                            : current,
                        )
                      }
                      onModeChange={handleMarkdownModeChange}
                      onSave={handleSaveMarkdown}
                      readOnly={!markdownPreviewWindow?.complete}
                      resourceContext={{
                        documentPath: markdownEditorState.path,
                        rootPath:
                          selectedHost.type === "ssh"
                            ? selectedHost.preset.defaultPath
                            : (resourceRootPath ?? defaultPath ?? currentPath),
                        sshTarget,
                      }}
                      saving={savingMarkdown}
                      showNavigation={showMarkdownNavigation}
                      windowNavigation={
                        showMarkdownNavigation &&
                        markdownPreviewWindow &&
                        (markdownWindowHistory.length > 0 ||
                          markdownPreviewWindow.nextOffset !== null)
                          ? {
                              label: formatMarkdownWindowRange(
                                markdownPreviewWindow,
                              ),
                              loading: markdownWindowLoading,
                              nextAvailable:
                                markdownPreviewWindow.nextOffset !== null,
                              onNext: () => {
                                void loadNextMarkdownWindow();
                              },
                              onPrevious: () => {
                                void loadPreviousMarkdownWindow();
                              },
                              previousAvailable:
                                markdownWindowHistory.length > 0,
                            }
                          : undefined
                      }
                    />
                  </Suspense>
                ) : (
                  <>
                    <div className="file-browser-preview-actions">
                      {editorState?.path === selectedFile.path ? (
                        <>
                          {editorState.content !== editorState.savedContent && (
                            <span className="markdown-file-preview-dirty">
                              未保存
                            </span>
                          )}
                          <button
                            className="file-browser-pill"
                            onClick={() => {
                              if (
                                editorState.content !==
                                  editorState.savedContent &&
                                !window.confirm(
                                  "当前文件有未保存修改，确定退出编辑？",
                                )
                              ) {
                                return;
                              }
                              setEditorState(null);
                            }}
                            type="button"
                          >
                            退出编辑
                          </button>
                          <button
                            className="file-browser-pill"
                            disabled={
                              editorState.content === editorState.savedContent
                            }
                            onClick={async () => {
                              const { path, content } = editorState;
                              await saveTextFile(path, content);
                              setEditorState((current) =>
                                current?.path === path
                                  ? { ...current, savedContent: content }
                                  : current,
                              );
                            }}
                            type="button"
                          >
                            保存
                          </button>
                        </>
                      ) : (
                        <button
                          className="file-browser-pill"
                          onClick={() => handleOpenEditor(selectedFile)}
                          type="button"
                        >
                          编辑
                        </button>
                      )}
                      {sshTarget && (
                        <button
                          className="file-browser-pill"
                          onClick={() =>
                            setChmodState({
                              path: selectedFile.path,
                              value: toModeFromPermissions(
                                selectedFile.permissions,
                              ),
                            })
                          }
                          type="button"
                        >
                          chmod
                        </button>
                      )}
                    </div>
                    {editorState?.path === selectedFile.path ? (
                      <textarea
                        aria-label={`${selectedFile.name} 源码编辑器`}
                        className="file-browser-editor file-browser-editor--inline"
                        onChange={(event) =>
                          setEditorState((current) =>
                            current
                              ? { ...current, content: event.target.value }
                              : current,
                          )
                        }
                        spellCheck={false}
                        value={editorState.content}
                      />
                    ) : (
                      <pre className="file-browser-preview-text">
                        {preview.content}
                      </pre>
                    )}
                  </>
                )}
              </>
            ) : imagePreview ? (
              <img
                alt={selectedFile.name}
                className="file-browser-preview-image"
                src={`data:${imagePreview.mimeType};base64,${imagePreview.content}`}
              />
            ) : (
              <div className="file-browser-preview-meta">
                <div>名称：{selectedFile.name}</div>
                <div>大小：{formatSize(selectedFile.size)}</div>
                <div>权限：{selectedFile.permissions}</div>
                <div>
                  时间：{new Date(selectedFile.modifiedAt).toLocaleString()}
                </div>
              </div>
            )
          ) : (
            <div className="file-browser-preview-empty">
              选择一个文件查看预览
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <aside
      className={`file-browser-drawer${dragActive ? " is-drag-active" : ""}`}
      data-testid="file-browser-drawer"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragDepth((current) => current + 1);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragDepth((current) => Math.max(0, current - 1));
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragDepth(0);
        const items = event.dataTransfer.items;
        if (!items || items.length === 0) return;

        const fileEntries: { file: File; relativePath: string }[] = [];

        const readEntry = (
          entry: FileSystemEntry,
          basePath: string,
        ): Promise<void> => {
          return new Promise((resolve) => {
            if (entry.isFile) {
              (entry as FileSystemFileEntry).file(
                (file) => {
                  fileEntries.push({
                    file,
                    relativePath: basePath + file.name,
                  });
                  resolve();
                },
                () => resolve(),
              );
            } else if (entry.isDirectory) {
              const reader = (entry as FileSystemDirectoryEntry).createReader();
              reader.readEntries(
                async (entries) => {
                  for (const child of entries) {
                    await readEntry(child, basePath + entry.name + "/");
                  }
                  resolve();
                },
                () => resolve(),
              );
            } else {
              resolve();
            }
          });
        };

        const hasDirectories = Array.from(items).some((item) => {
          const entry = item.webkitGetAsEntry?.();
          return entry?.isDirectory;
        });

        if (hasDirectories) {
          const entries = Array.from(items)
            .map((item) => item.webkitGetAsEntry?.())
            .filter(Boolean) as FileSystemEntry[];
          for (const entry of entries) {
            await readEntry(entry, "");
          }
          if (fileEntries.length > 0) {
            const files = fileEntries.map((e) => e.file);
            const relativePaths = fileEntries.map((e) => e.relativePath);
            await upload(files, undefined, relativePaths);
          }
        } else {
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) {
            await upload(files);
          }
        }
      }}
    >
      <header className="file-browser-header">
        <div>
          <div className="file-browser-title">文件浏览器</div>
          <div className="file-browser-subtitle">
            {selectedHost.type === "local"
              ? "本地文件系统"
              : `SSH / SFTP · ${selectedHost.preset.name}`}
          </div>
        </div>
        <HostDropdown
          sshHosts={sshHosts}
          onSelectHost={onSelectHost}
          triggerLabel="目标"
          buttonTestId="file-browser-host-toggle"
          menuTestId="file-browser-host-menu"
          menuAlign="end"
          triggerClassName="file-browser-pill"
        />
      </header>

      <div className="file-browser-toolbar">
        <button className="file-browser-pill" onClick={goHome} type="button">
          Home
        </button>
        <button
          className="file-browser-pill"
          disabled={!ready}
          onClick={goUp}
          type="button"
        >
          上级
        </button>
        <button
          className="file-browser-pill"
          onClick={() => refresh()}
          type="button"
        >
          刷新
        </button>
        <button
          className="file-browser-pill"
          disabled={!ready}
          onClick={() =>
            setCreateEntryState({
              kind: "directory",
              value: DEFAULT_CREATE_ENTRY_NAMES.directory,
            })
          }
          type="button"
        >
          新建
        </button>
        <button
          className="file-browser-pill"
          disabled={!ready}
          onClick={() => setUploadChoiceOpen(true)}
          type="button"
        >
          上传
        </button>
        <button
          className="file-browser-pill"
          disabled={!ready || selectedPaths.length === 0}
          onClick={() => downloadEntries(selectedPaths)}
          type="button"
        >
          下载
        </button>
        <button
          className="file-browser-pill danger"
          disabled={!ready || selectedPaths.length === 0}
          onClick={handleDeleteSelected}
          type="button"
        >
          删除
        </button>
        <label className="file-browser-toggle">
          <input
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
            type="checkbox"
          />
          <span>显示隐藏文件</span>
        </label>
        <input
          className="file-browser-filter"
          placeholder="过滤当前目录"
          value={filterQuery}
          onChange={(event) => setFilterQuery(event.target.value)}
        />
      </div>

      <div className="file-browser-path-bar">
        <input
          className="file-browser-path-input"
          value={pathInputValue}
          onChange={(event) => setPathInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const trimmed = pathInputValue.trim();
              if (trimmed) {
                navigate(trimmed);
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              setPathInputValue(currentPath || "/");
            }
          }}
          spellCheck={false}
          type="text"
        />
      </div>

      <div className="file-browser-body">
        <section
          className={`file-browser-content${previewExpanded ? " file-browser-content--preview-open" : ""}`}
          data-preview-expanded={previewExpanded ? "true" : "false"}
          ref={previewLayoutRef}
          style={{
            gridTemplateRows: getFileBrowserPreviewGridRows(
              previewExpanded,
              previewHeight,
            ),
          }}
        >
          <div className="file-browser-list">
            <div className="file-browser-pane-title">
              文件列表
              {loading && (
                <span className="file-browser-pane-hint">读取中…</span>
              )}
              {uploadProgress !== null && (
                <span className="file-browser-pane-hint">
                  上传 {Math.round(uploadProgress * 100)}%
                </span>
              )}
              {uploadStatus && uploadStatus.state !== "uploading" && (
                <span
                  className={`file-browser-pane-hint ${uploadStatus.state === "success" ? "success" : "error"}`}
                >
                  {uploadStatus.state === "success"
                    ? `✓ ${uploadStatus.total} 个文件上传成功`
                    : `✗ 上传失败: ${uploadStatus.message}`}
                </span>
              )}
            </div>
            {uploadProgress !== null && (
              <div className="file-browser-upload-progress-bar">
                <div
                  className="file-browser-upload-progress-fill"
                  style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                />
              </div>
            )}
            {uploadProgress !== null && (
              <div className="file-browser-upload-cancel-row">
                <span className="file-browser-upload-cancel-text">
                  正在上传 {Math.round(uploadProgress * 100)}%
                </span>
                <button
                  className="file-browser-pill danger"
                  onClick={cancelUpload}
                  type="button"
                >
                  取消上传
                </button>
              </div>
            )}
            {error && <div className="file-browser-error">{error}</div>}
            <div className="file-browser-table-scroll">
              <div
                className="file-browser-table file-browser-table--header"
                style={fileTableStyle}
              >
                {FILE_BROWSER_COLUMNS.map((column, index) => (
                  <div className="file-browser-header-cell" key={column.key}>
                    {column.key === "name" ? (
                      <div className="file-browser-name-header">
                        <button
                          className="file-browser-name-sort-button"
                          type="button"
                          onClick={() => toggleSort("name")}
                        >
                          {renderSortLabel(column)}
                        </button>
                        <button
                          aria-label="返回上一级目录"
                          className="file-browser-up-one-level"
                          disabled={!ready}
                          onClick={goUp}
                          title="返回上一级目录"
                          type="button"
                        >
                          ↑
                        </button>
                      </div>
                    ) : (
                      <button
                        className="file-browser-column-sort-button"
                        type="button"
                        onClick={() =>
                          column.sortKey && toggleSort(column.sortKey)
                        }
                      >
                        {renderSortLabel(column)}
                      </button>
                    )}
                    {index < FILE_BROWSER_COLUMNS.length - 1 && (
                      <button
                        aria-label={`调整${column.label}列宽`}
                        className="file-browser-column-resizer"
                        data-testid={`file-browser-column-resizer-${column.key}`}
                        onMouseDown={(event) => {
                          columnResizeRef.current = {
                            key: column.key,
                            startX: event.clientX,
                            startWidth: columnWidths[column.key],
                          };
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        role="separator"
                        title={`拖动调整${column.label}列宽`}
                        type="button"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div
                className="file-browser-rows"
                data-testid="file-browser-rows"
              >
                {entries.map((entry) => {
                  const selected = selectedPaths.includes(entry.path);
                  return (
                    <div
                      key={entry.path}
                      className={`file-browser-table file-browser-row${selected ? " is-selected" : ""}`}
                      data-testid={`file-entry-${entry.name}`}
                      style={fileTableStyle}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", entry.path);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={(event) =>
                        selectFileBrowserPath(entry.path, {
                          additive: event.metaKey || event.ctrlKey,
                          range: event.shiftKey,
                        })
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!selectFileBrowserPath(entry.path)) {
                          return;
                        }
                        setContextMenu({
                          entry,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      onDoubleClick={async () => {
                        if (
                          entry.type === "directory" ||
                          (entry.type === "symlink" &&
                            entry.symlinkTargetType === "directory")
                        ) {
                          await navigate(entry.path);
                          return;
                        }

                        if (!selectFileBrowserPath(entry.path)) {
                          return;
                        }
                        await handleOpenPreview(entry);
                      }}
                    >
                      <label className="file-browser-name">
                        <input
                          checked={selected}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            setCheckboxSelection(
                              entry.path,
                              event.currentTarget.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span className="file-browser-icon">
                          {getFileIcon(entry)}
                        </span>
                        <span>{entry.name}</span>
                      </label>
                      <span>
                        {entry.type === "directory" ||
                        (entry.type === "symlink" &&
                          entry.symlinkTargetType === "directory")
                          ? "—"
                          : formatSize(entry.size)}
                      </span>
                      <span>{new Date(entry.modifiedAt).toLocaleString()}</span>
                      <span>{entry.owner}</span>
                      <span>{entry.permissions}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div
            className="file-browser-preview-splitter"
            data-testid="file-browser-preview-splitter"
            onMouseDown={(event) => {
              previewResizeRef.current = {
                startY: event.clientY,
                startHeight: previewHeight,
              };
              event.preventDefault();
            }}
            role="separator"
          />

          {!previewFullscreen && renderFilePreview(false)}
        </section>
      </div>

      {previewFullscreen && typeof document !== "undefined"
        ? createPortal(renderFilePreview(true), document.body)
        : null}

      {contextMenu && (
        <div
          className="file-browser-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {(contextMenu.entry.type === "directory" ||
            (contextMenu.entry.type === "symlink" &&
              contextMenu.entry.symlinkTargetType === "directory")) && (
            <button
              onClick={() => {
                const targetPath = contextMenu.entry.path;
                setContextMenu(null);
                navigate(targetPath).then(() => {
                  setUploadChoiceOpen(true);
                });
              }}
              type="button"
            >
              上传到此目录
            </button>
          )}
          <button
            onClick={() => {
              setContextMenu(null);
              setUploadChoiceOpen(true);
            }}
            type="button"
          >
            上传到当前目录
          </button>
          <button
            onClick={() => downloadEntries([contextMenu.entry.path])}
            type="button"
          >
            下载
          </button>
          <button
            onClick={() =>
              setRenameState({
                path: contextMenu.entry.path,
                value: contextMenu.entry.name,
              })
            }
            type="button"
          >
            重命名
          </button>
          <button
            onClick={async () => {
              if (window.confirm(`删除 ${contextMenu.entry.name}？`)) {
                await deleteEntries([contextMenu.entry.path]);
              }
            }}
            type="button"
          >
            删除
          </button>
          <button
            onClick={async () => {
              await copyTextToClipboard(contextMenu.entry.path);
              setContextMenu(null);
            }}
            type="button"
          >
            复制路径
          </button>
          {sshTarget && (
            <button
              onClick={() =>
                setChmodState({
                  path: contextMenu.entry.path,
                  value: toModeFromPermissions(contextMenu.entry.permissions),
                })
              }
              type="button"
            >
              属性 / chmod
            </button>
          )}
        </div>
      )}

      {createEntryState && (
        <div className="file-browser-modal">
          <div className="file-browser-dialog">
            <h3>新建{getCreateEntryLabel(createEntryState.kind)}</h3>
            <div className="file-browser-dialog-kind-tabs">
              <button
                aria-pressed={createEntryState.kind === "directory"}
                className={`file-browser-pill${createEntryState.kind === "directory" ? " is-active" : ""}`}
                onClick={() =>
                  setCreateEntryState((current) =>
                    current
                      ? {
                          kind: "directory",
                          value:
                            current.value ===
                            DEFAULT_CREATE_ENTRY_NAMES[current.kind]
                              ? DEFAULT_CREATE_ENTRY_NAMES.directory
                              : current.value,
                        }
                      : current,
                  )
                }
                type="button"
              >
                文件夹
              </button>
              <button
                aria-pressed={createEntryState.kind === "file"}
                className={`file-browser-pill${createEntryState.kind === "file" ? " is-active" : ""}`}
                onClick={() =>
                  setCreateEntryState((current) =>
                    current
                      ? {
                          kind: "file",
                          value:
                            current.value ===
                            DEFAULT_CREATE_ENTRY_NAMES[current.kind]
                              ? DEFAULT_CREATE_ENTRY_NAMES.file
                              : current.value,
                        }
                      : current,
                  )
                }
                type="button"
              >
                文件
              </button>
            </div>
            <input
              className="drawer-input"
              placeholder={`输入${getCreateEntryLabel(createEntryState.kind)}名称`}
              value={createEntryState.value}
              onChange={(event) =>
                setCreateEntryState((current) =>
                  current
                    ? {
                        ...current,
                        value: event.target.value,
                      }
                    : current,
                )
              }
            />
            <div className="file-browser-dialog-actions">
              <button
                className="file-browser-pill"
                onClick={() => setCreateEntryState(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="file-browser-pill"
                disabled={!createEntryState.value.trim()}
                onClick={async () => {
                  const nextName = createEntryState.value.trim();
                  if (!nextName) {
                    return;
                  }

                  if (createEntryState.kind === "directory") {
                    await createFolder(nextName);
                  } else {
                    await createFile(nextName);
                  }

                  setCreateEntryState(null);
                }}
                type="button"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadChoiceOpen && (
        <div className="file-browser-modal">
          <div className="file-browser-dialog">
            <h3>上传</h3>
            <div className="file-browser-dialog-kind-tabs">
              <button
                className="file-browser-pill"
                onClick={() => {
                  setUploadChoiceOpen(false);
                  fileInputRef.current?.click();
                }}
                type="button"
              >
                文件
              </button>
              <button
                className="file-browser-pill"
                onClick={() => {
                  setUploadChoiceOpen(false);
                  folderInputRef.current?.click();
                }}
                type="button"
              >
                文件夹
              </button>
            </div>
            <div className="file-browser-dialog-actions">
              <button
                className="file-browser-pill"
                onClick={() => setUploadChoiceOpen(false)}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {renameState && (
        <div className="file-browser-modal">
          <div className="file-browser-dialog">
            <h3>重命名</h3>
            <input
              className="drawer-input"
              value={renameState.value}
              onChange={(event) =>
                setRenameState((current) =>
                  current
                    ? {
                        ...current,
                        value: event.target.value,
                      }
                    : current,
                )
              }
            />
            <div className="file-browser-dialog-actions">
              <button
                className="file-browser-pill"
                onClick={() => setRenameState(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="file-browser-pill"
                onClick={async () => {
                  await renameEntry(renameState.path, renameState.value);
                  setRenameState(null);
                }}
                type="button"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {chmodState && (
        <div className="file-browser-modal">
          <div className="file-browser-dialog">
            <h3>权限设置</h3>
            <div className="file-browser-chmod-grid">
              {["Owner", "Group", "Other"].map((label, groupIndex) => (
                <div key={label} className="file-browser-chmod-group">
                  <span>{label}</span>
                  {[
                    { label: "r", value: 4 },
                    { label: "w", value: 2 },
                    { label: "x", value: 1 },
                  ].map((permission) => {
                    const currentDigit = chmodState.value[groupIndex] ?? "0";
                    const checked =
                      (Number(currentDigit) & permission.value) ===
                      permission.value;

                    return (
                      <label
                        key={permission.label}
                        className="file-browser-toggle"
                      >
                        <input
                          checked={checked}
                          onChange={(event) => {
                            setChmodState((current) => {
                              if (!current) {
                                return current;
                              }

                              const digits = current.value.split("");
                              digits[groupIndex] = updateModeDigit(
                                digits[groupIndex] ?? "0",
                                permission.value,
                                event.target.checked,
                              );
                              return {
                                ...current,
                                value: digits.join(""),
                              };
                            });
                          }}
                          type="checkbox"
                        />
                        <span>{permission.label}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="file-browser-dialog-actions">
              <button
                className="file-browser-pill"
                onClick={() => setChmodState(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="file-browser-pill"
                onClick={async () => {
                  await updatePermissions(chmodState.path, chmodState.value);
                  setChmodState(null);
                }}
                type="button"
              >
                应用 {chmodState.value}
              </button>
            </div>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="file-browser-upload-zone">
          拖入文件或文件夹即可上传到 {currentPath || "当前目录"}
        </div>
      )}

      <input
        data-testid="file-browser-upload-file-input"
        hidden
        multiple
        ref={fileInputRef}
        type="file"
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            await upload(files);
          }
          event.target.value = "";
        }}
      />
      <input
        data-testid="file-browser-upload-folder-input"
        hidden
        ref={folderInputRef}
        type="file"
        {...({
          webkitdirectory: "",
          directory: "",
          multiple: true,
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            const relativePaths = files.map((file) => {
              return (
                (file as File & { webkitRelativePath: string })
                  .webkitRelativePath || file.name
              );
            });
            await upload(files, undefined, relativePaths);
          }
          event.target.value = "";
        }}
      />
    </aside>
  );
}
