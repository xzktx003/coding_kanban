import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  FileEntry,
  FilePreviewResponse,
  SshTarget,
} from "@agent-orchestrator/shared";

import {
  chmodFile,
  downloadFile,
  fileOperation,
  listFiles,
  previewFile,
  uploadFiles,
} from "./api";

export type SortKey = "name" | "size" | "modifiedAt" | "owner" | "permissions";
export type SortDirection = "asc" | "desc";
const FILE_BROWSER_SCOPE_STATE_PREFIX = "file-browser-scope-state";

interface PersistedBrowserScopeState {
  currentPath: string;
  showHidden: boolean;
  filterQuery: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
}

export function getFileBrowserParentPath(inputPath: string): string {
  if (!inputPath || inputPath === "/") {
    return "/";
  }

  const trimmed = inputPath.replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return trimmed.startsWith("/") ? "/" : (parts[0] ?? "/");
  }

  return `${trimmed.startsWith("/") ? "/" : ""}${parts.slice(0, -1).join("/")}`;
}

function joinPath(basePath: string, name: string): string {
  if (!basePath || basePath === "/") {
    return `/${name}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${name}`;
}

function toSshTarget(
  host:
    | { type: "local" }
    | {
        type: "ssh";
        preset: {
          host: string;
          port: number;
          username?: string;
          identityFile?: string;
        };
      },
): SshTarget | undefined {
  if (host.type === "local") {
    return undefined;
  }

  return {
    host: host.preset.host,
    port: host.preset.port,
    username: host.preset.username,
    identityFile: host.preset.identityFile,
  };
}

function buildHostScopeKey(selectedHost: UseFileBrowserHost): string {
  if (selectedHost.type === "local") {
    return "local";
  }

  const preset = selectedHost.preset;
  return [
    "ssh",
    preset?.host ?? "",
    String(preset?.port ?? 22),
    preset?.username ?? "",
    preset?.identityFile ?? "",
  ].join(":");
}

function buildScopeStorageKey(scopeKey: string, hostScopeKey: string): string {
  return `${FILE_BROWSER_SCOPE_STATE_PREFIX}:${scopeKey}:${hostScopeKey}`;
}

function loadPersistedBrowserScopeState(
  scopeKey: string,
  hostScopeKey: string,
  defaultPath: string,
): PersistedBrowserScopeState {
  const fallback: PersistedBrowserScopeState = {
    currentPath: defaultPath,
    showHidden: false,
    filterQuery: "",
    sortKey: "name",
    sortDirection: "asc",
  };

  try {
    const raw = localStorage.getItem(
      buildScopeStorageKey(scopeKey, hostScopeKey),
    );
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedBrowserScopeState>;
    return {
      currentPath:
        typeof parsed.currentPath === "string" && parsed.currentPath.trim()
          ? parsed.currentPath
          : fallback.currentPath,
      showHidden: Boolean(parsed.showHidden),
      filterQuery:
        typeof parsed.filterQuery === "string" ? parsed.filterQuery : "",
      sortKey:
        parsed.sortKey === "size" ||
        parsed.sortKey === "modifiedAt" ||
        parsed.sortKey === "owner" ||
        parsed.sortKey === "permissions" ||
        parsed.sortKey === "name"
          ? parsed.sortKey
          : "name",
      sortDirection:
        parsed.sortDirection === "desc" ? "desc" : fallback.sortDirection,
    };
  } catch {
    return fallback;
  }
}

function savePersistedBrowserScopeState(
  scopeKey: string,
  hostScopeKey: string,
  state: PersistedBrowserScopeState,
) {
  try {
    localStorage.setItem(
      buildScopeStorageKey(scopeKey, hostScopeKey),
      JSON.stringify(state),
    );
  } catch {
    // ignore storage failures
  }
}

export interface UseFileBrowserHost {
  type: "local" | "ssh";
  preset?: {
    host: string;
    port: number;
    username?: string;
    identityFile?: string;
    defaultPath: string;
  };
}

interface UseFileBrowserOptions {
  scopeKey: string;
  defaultPath?: string;
}

export function useFileBrowser(
  selectedHost: UseFileBrowserHost,
  active: boolean,
  options: UseFileBrowserOptions,
) {
  const { scopeKey, defaultPath } = options;
  const sshTarget = useMemo(
    () =>
      selectedHost.type === "ssh" && selectedHost.preset
        ? toSshTarget({ type: "ssh", preset: selectedHost.preset })
        : undefined,
    [selectedHost],
  );
  const hostScopeKey = useMemo(
    () => buildHostScopeKey(selectedHost),
    [selectedHost],
  );
  const hostDefaultPath =
    selectedHost.type === "ssh" && selectedHost.preset
      ? selectedHost.preset.defaultPath
      : defaultPath?.trim() || "~";
  const initialScopeStateRef = useRef<PersistedBrowserScopeState | null>(null);
  if (initialScopeStateRef.current === null) {
    initialScopeStateRef.current = loadPersistedBrowserScopeState(
      scopeKey,
      hostScopeKey,
      hostDefaultPath,
    );
  }
  const [currentPath, setCurrentPath] = useState(
    initialScopeStateRef.current.currentPath,
  );
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(
    initialScopeStateRef.current.showHidden,
  );
  const [filterQuery, setFilterQuery] = useState(
    initialScopeStateRef.current.filterQuery,
  );
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(
    initialScopeStateRef.current.sortKey,
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialScopeStateRef.current.sortDirection,
  );
  const [preview, setPreview] = useState<FilePreviewResponse | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    state: "uploading" | "success" | "error";
    total: number;
    message?: string;
  } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const currentPathRef = useRef(currentPath);
  const listRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const hiddenPrefRef = useRef(showHidden);
  const skipPersistRef = useRef(true);

  const runDirectoryLoad = useCallback(
    async (
      requestedPath: string,
      showHiddenOverride = hiddenPrefRef.current,
    ) => {
      const requestId = ++listRequestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const response = await listFiles({
          path: requestedPath,
          sshTarget,
          showHidden: showHiddenOverride,
        });

        if (requestId !== listRequestIdRef.current) {
          return null;
        }

        setEntries(response.entries);
        setCurrentPath(response.path);
        currentPathRef.current = response.path;
        setSelectedPaths([]);
        setLastSelectedPath(null);
        return response;
      } catch (caughtError) {
        if (requestId === listRequestIdRef.current) {
          setError(
            caughtError instanceof Error ? caughtError.message : "读取目录失败",
          );
        }
        return null;
      } finally {
        if (requestId === listRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [sshTarget],
  );

  const refresh = useCallback(
    async (pathOverride?: string, showHiddenOverride?: boolean) => {
      await runDirectoryLoad(
        pathOverride ?? currentPathRef.current,
        showHiddenOverride,
      );
    },
    [runDirectoryLoad],
  );

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const nextState = loadPersistedBrowserScopeState(
      scopeKey,
      hostScopeKey,
      hostDefaultPath,
    );

    skipPersistRef.current = true;
    listRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    currentPathRef.current = nextState.currentPath;
    setCurrentPath(nextState.currentPath);
    setEntries([]);
    setSelectedPaths([]);
    setLastSelectedPath(null);
    setPreview(null);
    setError(null);
    setShowHidden(nextState.showHidden);
    setFilterQuery(nextState.filterQuery);
    setSortKey(nextState.sortKey);
    setSortDirection(nextState.sortDirection);
    hiddenPrefRef.current = nextState.showHidden;

    if (!active) {
      return;
    }

    void runDirectoryLoad(nextState.currentPath, nextState.showHidden);
  }, [active, hostDefaultPath, hostScopeKey, runDirectoryLoad, scopeKey]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    savePersistedBrowserScopeState(scopeKey, hostScopeKey, {
      currentPath,
      showHidden,
      filterQuery,
      sortKey,
      sortDirection,
    });
  }, [
    currentPath,
    filterQuery,
    hostScopeKey,
    scopeKey,
    showHidden,
    sortDirection,
    sortKey,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (hiddenPrefRef.current === showHidden) {
      return;
    }

    hiddenPrefRef.current = showHidden;
    void refresh(undefined, showHidden);
  }, [active, refresh, showHidden]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = filterQuery.trim().toLowerCase();
    const filtered = normalizedQuery
      ? entries.filter((entry) =>
          entry.name.toLowerCase().includes(normalizedQuery),
        )
      : entries;

    const factor = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (left.type === "directory" && right.type !== "directory") {
        return -1;
      }

      if (left.type !== "directory" && right.type === "directory") {
        return 1;
      }

      if (sortKey === "size") {
        return (left.size - right.size) * factor;
      }

      if (sortKey === "modifiedAt") {
        return (
          (new Date(left.modifiedAt).getTime() -
            new Date(right.modifiedAt).getTime()) *
          factor
        );
      }

      if (sortKey === "permissions") {
        return left.permissions.localeCompare(right.permissions) * factor;
      }

      if (sortKey === "owner") {
        return left.owner.localeCompare(right.owner) * factor;
      }

      return left.name.localeCompare(right.name) * factor;
    });
  }, [entries, filterQuery, sortDirection, sortKey]);

  useEffect(() => {
    const selectedPath =
      selectedPaths.length === 1
        ? filteredEntries.find((entry) => entry.path === selectedPaths[0])
        : undefined;

    if (!selectedPath || selectedPath.type === "directory") {
      setPreview(null);
      return;
    }

    const requestId = ++previewRequestIdRef.current;

    previewFile({
      path: selectedPath.path,
      sshTarget,
    })
      .then((response) => {
        if (requestId === previewRequestIdRef.current) {
          setPreview(response);
        }
      })
      .catch(() => {
        if (requestId === previewRequestIdRef.current) {
          setPreview(null);
        }
      });
  }, [filteredEntries, selectedPaths, sshTarget]);

  const navigate = useCallback(
    async (nextPath: string) => {
      await refresh(nextPath);
    },
    [refresh],
  );

  const toggleSort = useCallback((nextKey: SortKey) => {
    setSortKey((current) => {
      if (current === nextKey) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }

      setSortDirection("asc");
      return nextKey;
    });
  }, []);

  const selectPath = useCallback(
    (
      pathValue: string,
      modifiers?: { additive?: boolean; range?: boolean },
    ) => {
      if (modifiers?.range && lastSelectedPath) {
        const visiblePaths = filteredEntries.map((entry) => entry.path);
        const start = visiblePaths.indexOf(lastSelectedPath);
        const end = visiblePaths.indexOf(pathValue);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelectedPaths(visiblePaths.slice(from, to + 1));
          return;
        }
      }

      if (modifiers?.additive) {
        setSelectedPaths((current) =>
          current.includes(pathValue)
            ? current.filter((value) => value !== pathValue)
            : [...current, pathValue],
        );
        setLastSelectedPath(pathValue);
        return;
      }

      setSelectedPaths([pathValue]);
      setLastSelectedPath(pathValue);
    },
    [filteredEntries, lastSelectedPath],
  );

  const setCheckboxSelection = useCallback(
    (pathValue: string, checked: boolean) => {
      setSelectedPaths((current) => {
        if (checked) {
          return current.includes(pathValue)
            ? current
            : [...current, pathValue];
        }

        return current.filter((value) => value !== pathValue);
      });
      setLastSelectedPath(pathValue);
    },
    [],
  );

  const createFolder = useCallback(
    async (folderName: string) => {
      if (!currentPath.trim()) {
        throw new Error("当前目录尚未准备好");
      }
      await fileOperation({
        operation: "mkdir",
        path: joinPath(currentPath, folderName),
        sshTarget,
      });
      await refresh();
    },
    [currentPath, refresh, sshTarget],
  );

  const renameEntry = useCallback(
    async (entryPath: string, nextName: string) => {
      const parentPath = getFileBrowserParentPath(entryPath);
      await fileOperation({
        operation: "rename",
        path: entryPath,
        newPath: joinPath(parentPath, nextName),
        sshTarget,
      });
      await refresh();
    },
    [refresh, sshTarget],
  );

  const deleteEntries = useCallback(
    async (paths: string[]) => {
      for (const pathValue of paths) {
        await fileOperation({
          operation: "delete",
          path: pathValue,
          sshTarget,
        });
      }
      await refresh();
    },
    [refresh, sshTarget],
  );

  const upload = useCallback(
    async (files: File[], overwritePath?: string, relativePaths?: string[]) => {
      if (!overwritePath && !currentPath.trim()) {
        throw new Error("当前目录尚未准备好");
      }
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      setUploadProgress(0);
      setUploadStatus({ state: "uploading", total: files.length });
      try {
        await uploadFiles({
          path: overwritePath ? undefined : currentPath,
          overwritePath,
          sshTarget,
          files,
          relativePaths,
          onProgress: setUploadProgress,
          signal: abortController.signal,
        });
        setUploadStatus({ state: "success", total: files.length });
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        if (message === "Upload cancelled") {
          setUploadStatus({
            state: "error",
            total: files.length,
            message: "已取消上传",
          });
        } else {
          setUploadStatus({ state: "error", total: files.length, message });
        }
      } finally {
        uploadAbortRef.current = null;
        setUploadProgress(null);
        setTimeout(() => setUploadStatus(null), 4000);
      }
    },
    [currentPath, refresh, sshTarget],
  );

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const saveTextFile = useCallback(
    async (filePath: string, content: string) => {
      const name = filePath.split("/").filter(Boolean).pop() ?? "file.txt";
      await upload(
        [new File([content], name, { type: "text/plain" })],
        filePath,
      );
      setSelectedPaths([filePath]);
    },
    [upload],
  );

  const createFile = useCallback(
    async (fileName: string) => {
      if (!currentPath.trim()) {
        throw new Error("当前目录尚未准备好");
      }

      await saveTextFile(joinPath(currentPath, fileName), "");
    },
    [currentPath, saveTextFile],
  );

  const downloadEntries = useCallback(
    async (paths: string[]) => {
      for (const pathValue of paths) {
        await downloadFile({ path: pathValue, sshTarget });
      }
    },
    [sshTarget],
  );

  const updatePermissions = useCallback(
    async (filePath: string, mode: string) => {
      await chmodFile({
        path: filePath,
        mode,
        sshTarget,
      });
      await refresh();
    },
    [refresh, sshTarget],
  );

  const ready = currentPath.trim().length > 0;

  return {
    ready,
    currentPath,
    entries: filteredEntries,
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
    goHome: () => refresh(hostDefaultPath),
    goUp: () => refresh(getFileBrowserParentPath(currentPath)),
  };
}
