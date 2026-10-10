import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@session/components/ui/dialog";
import { Button } from "@session/components/ui/button";
import { readDirectory } from "@session/services/apiAdapt/filesystem";
import {
  workspaceFileRequest,
  uploadWorkspaceFile,
  downloadWorkspaceFile,
  type TrashEntry,
} from "@session/services/workspaceFiles";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { copyTextToClipboard } from "../../../lib/clipboard";
import type { FileAction } from "./explorer/types";
export type FileOperationTarget = {
  type: FileAction | "purge";
  root: string;
  path: string;
  isDir: boolean;
  id?: string;
};
export type FileOperationSelection = {
  path: string;
  isDir: boolean;
};
const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const name = (path: string) => path.split("/").pop() ?? "";
const join = (dir: string, file: string) => dir.replace(/\/$/, "") + "/" + file;
const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
const isInsideRoot = (root: string, path: string) =>
  path === root || path.startsWith(root.replace(/\/$/, "") + "/");
const relativePath = (root: string, path: string) => {
  const base = root.replace(/\/+$/, "");
  return path.replace(/\/+$/, "") === base
    ? "."
    : path.startsWith(base + "/")
      ? path.slice(base.length + 1)
      : path;
};
export const refreshFiles = (root: string) =>
  window.dispatchEvent(
    new CustomEvent("workspace-files-changed", { detail: { root } }),
  );
export function FileOperations({
  root,
  target,
  action,
  onAction,
}: {
  root: string | null;
  target?: FileOperationSelection | null;
  action: FileOperationTarget | null;
  onAction: (a: FileOperationTarget | null) => void;
}) {
  const [value, setValue] = useState(""),
    [destination, setDestination] = useState(""),
    [directories, setDirectories] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState<{
      file: string;
      index: number;
      total: number;
      percent: number;
    } | null>(null);
  const busyRef = useRef(false),
    uploadRef = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<{ root: string; dir: string } | null>(null),
    uploadAbort = useRef<AbortController | null>(null);
  const [trashRoot, setTrashRoot] = useState<string | null>(null),
    [trash, setTrash] = useState<TrashEntry[]>([]);
  const [uploadConflict, setUploadConflict] = useState<{
      path: string;
      name: string;
    } | null>(null),
    [uploadName, setUploadName] = useState("");
  const conflictAnswer = useRef<
    ((answer: { path: string; overwrite: boolean } | null) => void) | null
  >(null);
  const selectedTarget =
    root && target && isInsideRoot(root, target.path) ? target : null;
  const operationPath = selectedTarget?.path ?? root ?? "";
  const operationIsDir = selectedTarget?.isDir ?? true;
  const operationDir = operationIsDir ? operationPath : parent(operationPath);
  const downloadLabel = operationIsDir ? "下载文件夹（ZIP）" : "下载文件";
  useEffect(
    () => () => {
      conflictAnswer.current?.(null);
      uploadAbort.current?.abort();
    },
    [],
  );
  const loadTrash = async (r: string) => {
    try {
      setTrash(
        await workspaceFileRequest<TrashEntry[]>("trash-list", { root: r }),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!action) return;
    setError("");
    setValue(
      action.type === "rename" || action.type === "move"
        ? name(action.path)
        : "",
    );
    setDestination(action.root);
    if (action.type === "copy-path" || action.type === "copy-relative") {
      const text =
        action.type === "copy-path"
          ? action.path
          : relativePath(action.root, action.path);
      void copyPath(text);
      onAction(null);
    } else if (action.type === "download") {
      void downloadWorkspaceFile(action.root, action.path).catch((e) =>
        setError(String(e)),
      );
      onAction(null);
    } else if (action.type === "upload") {
      uploadTarget.current = {
        root: action.root,
        dir: action.isDir ? action.path : parent(action.path),
      };
      uploadRef.current?.click();
      onAction(null);
    }
  }, [action]);
  useEffect(() => {
    if (action?.type !== "move") return;
    let active = true;
    void readDirectory(destination)
      .then((entries) => {
        if (active)
          setDirectories(entries.filter((e) => e.is_dir).map((e) => e.path));
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [action?.type, destination]);
  useEffect(() => {
    const handleUpload = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          root?: unknown;
          dir?: unknown;
          files?: unknown;
        }>
      ).detail;
      if (
        !root ||
        !detail ||
        detail.root !== root ||
        typeof detail.dir !== "string" ||
        !isInsideRoot(root, detail.dir) ||
        !Array.isArray(detail.files) ||
        !detail.files.every((file) => file instanceof File)
      )
        return;
      if (busyRef.current) {
        setNotice("文件操作进行中，请稍后再上传");
        return;
      }
      void uploadFiles(detail.files, { root, dir: detail.dir });
    };
    window.addEventListener("workspace-files-upload", handleUpload);
    return () =>
      window.removeEventListener("workspace-files-upload", handleUpload);
  }, [root]);
  const copyPath = async (text: string) => {
    setError("");
    const copied = await copyTextToClipboard(text);
    if (copied) setNotice("路径已复制");
    else setError(`浏览器阻止复制，请手动复制：${text}`);
  };
  const startDownload = async () => {
    if (!root || busyRef.current) return;
    setError("");
    try {
      await downloadWorkspaceFile(root, operationPath);
      setNotice(operationIsDir ? "已开始下载 ZIP" : "已开始下载文件");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const finish = async () => {
    if (!action || busyRef.current) return;
    const target = action;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (target.type === "delete") {
        await workspaceFileRequest("trash", {
          root: target.root,
          path: target.path,
        });
        const store = useEditorStore.getState();
        for (const p of store.openFiles)
          if (p === target.path || p.startsWith(target.path + "/"))
            store.closeFile(p);
        setNotice("已移入回收站，未保存草稿仍保留在当前浏览器");
      } else if (target.type === "purge") {
        await workspaceFileRequest("purge", {
          root: target.root,
          id: target.id,
        });
        await loadTrash(target.root);
      } else if (target.type === "rename" || target.type === "move") {
        const next = join(
          target.type === "rename" ? parent(target.path) : destination,
          value.trim(),
        );
        await workspaceFileRequest("move", {
          root: target.root,
          path: target.path,
          destination: next,
        });
        useFileDocumentStore.getState().move(target.path, next);
        useEditorStore.getState().moveFiles(target.path, next);
      } else {
        const next = join(
          target.isDir ? target.path : parent(target.path),
          value.trim(),
        );
        const result = await workspaceFileRequest<{ path: string }>("create", {
          root: target.root,
          path: next,
          kind: target.type === "new-folder" ? "directory" : "file",
        });
        if (target.type === "new-file")
          useEditorStore.getState().openFile(result.path, target.root);
      }
      refreshFiles(target.root);
      onAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const uploadFiles = async (
    files: FileList | File[] | null,
    target = uploadTarget.current,
  ) => {
    if (!files || !target || busyRef.current) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      let done = 0;
      for (const file of list) {
        uploadAbort.current = new AbortController();
        setProgress({
          file: file.name,
          index: done + 1,
          total: list.length,
          percent: 0,
        });
        setNotice(`上传 ${done + 1}/${list.length}：${file.name}`);
        let path = join(target.dir, file.name),
          version: string | undefined;
        const options = {
          signal: uploadAbort.current.signal,
          onProgress: (percent: number) =>
            setProgress({
              file: file.name,
              index: done + 1,
              total: list.length,
              percent,
            }),
        };
        try {
          await uploadWorkspaceFile(
            target.root,
            path,
            file,
            undefined,
            options,
          );
        } catch (e) {
          if (isAbortError(e)) {
            setNotice("已取消上传");
            return;
          }
          if (!String(e).includes("已存在")) throw e;
          const choice = await new Promise<{
            path: string;
            overwrite: boolean;
          } | null>((resolve) => {
            conflictAnswer.current = resolve;
            setUploadName(file.name);
            setUploadConflict({ path, name: file.name });
          });
          setUploadConflict(null);
          conflictAnswer.current = null;
          if (options.signal.aborted) {
            setNotice("已取消上传");
            return;
          }
          if (!choice) {
            done++;
            continue;
          }
          path = choice.path;
          if (choice.overwrite)
            version = (
              await workspaceFileRequest<{ version: string }>("version", {
                root: target.root,
                path,
              })
            ).version;
          await uploadWorkspaceFile(target.root, path, file, version, options);
        }
        done++;
        refreshFiles(target.root);
      }
      setNotice(`上传处理完成：${done} 个文件`);
    } catch (e) {
      if (isAbortError(e)) setNotice("已取消上传");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      uploadAbort.current = null;
      setProgress(null);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };
  const labels: Record<string, string> = {
    "new-file": "新建文件",
    "new-folder": "新建文件夹",
    rename: "重命名",
    move: "移动",
    delete: "移入回收站",
    purge: "永久删除",
  };
  const modal =
    action &&
    !["download", "upload", "copy-path", "copy-relative"].includes(action.type);
  const validName =
    value.trim() &&
    !/[\/\\\x00-\x1f]/.test(value) &&
    value !== "." &&
    value !== "..";
  return (
    <>
      <div className="session-file-tools" role="toolbar" aria-label="文件管理">
        {(
          [
            ["new-file", "新建文件", FilePlus],
            ["new-folder", "新建文件夹", FolderPlus],
          ] as const
        ).map(([type, label, Icon]) => (
          <button
            type="button"
            disabled={!root || busy}
            key={type}
            aria-label={label}
            title={label}
            onClick={() =>
              root &&
              onAction({
                type,
                root,
                path: operationPath || root,
                isDir: operationIsDir,
              })
            }
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={!root || busy}
          aria-label="上传文件"
          title="上传文件"
          onClick={() => {
            if (root) {
              uploadTarget.current = { root, dir: operationDir || root };
              uploadRef.current?.click();
            }
          }}
        >
          <Upload size={16} />
          <span>上传文件</span>
        </button>
        <button
          type="button"
          disabled={!root || busy || !operationPath}
          aria-label={downloadLabel}
          title={downloadLabel}
          onClick={() => void startDownload()}
        >
          <Download size={16} />
          <span>{downloadLabel}</span>
        </button>
        <button
          type="button"
          disabled={!root || busy || !operationPath}
          aria-label="复制绝对路径"
          title="复制绝对路径"
          onClick={() => void copyPath(operationPath)}
        >
          <Copy size={16} />
          <span>复制绝对路径</span>
        </button>
        <button
          type="button"
          disabled={!root || busy || !operationPath}
          aria-label="复制相对路径"
          title="复制相对路径"
          onClick={() =>
            root && void copyPath(relativePath(root, operationPath))
          }
        >
          <Copy size={16} />
          <span>复制相对路径</span>
        </button>
        <button
          type="button"
          disabled={!root || busy}
          aria-label="刷新文件"
          title="刷新文件"
          onClick={() => root && refreshFiles(root)}
        >
          <RefreshCw size={16} />
          <span>刷新</span>
        </button>
        <button
          type="button"
          disabled={!root || busy}
          aria-label="回收站"
          title="回收站"
          onClick={() => {
            if (root) {
              setTrashRoot(root);
              void loadTrash(root);
            }
          }}
        >
          <Trash2 size={16} />
          <span>回收站</span>
        </button>
        {progress && (
          <div className="flex min-w-44 items-center gap-2 text-xs">
            <progress
              aria-label="上传进度"
              max={100}
              value={progress.percent}
              className="h-2 w-24"
            />
            <span className="truncate">
              上传 {progress.index}/{progress.total}：{progress.file}{" "}
              {progress.percent}%
            </span>
            <button
              type="button"
              aria-label="取消上传"
              title="取消上传"
              onClick={() => {
                conflictAnswer.current?.(null);
                uploadAbort.current?.abort();
              }}
            >
              <X size={14} />
              <span>取消上传</span>
            </button>
          </div>
        )}
        <span role="status" className="text-xs truncate">
          {notice}
        </span>
        <input
          ref={uploadRef}
          type="file"
          multiple
          className="hidden"
          aria-label="选择上传文件"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
      </div>
      {error && !modal && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(open) => {
          if (!open && !busy) onAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{action ? labels[action.type] : ""}</DialogTitle>
          <DialogDescription>
            {action?.path}
            {action?.type === "delete"
              ? " 将移入应用回收站，可恢复。"
              : action?.type === "purge"
                ? " 将永久删除，无法恢复。"
                : " 操作范围限定在该项目内。"}
          </DialogDescription>
          {action?.type === "move" && (
            <label className="text-sm">
              目标目录
              <select
                aria-label="目标目录"
                className="session-file-input"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {[
                  ...new Set([
                    action.root,
                    destination,
                    ...(destination !== action.root
                      ? [parent(destination)]
                      : []),
                    ...directories,
                  ]),
                ].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action &&
            ["new-file", "new-folder", "rename", "move"].includes(
              action.type,
            ) && (
              <label className="text-sm">
                名称
                <input
                  autoFocus
                  className="session-file-input"
                  aria-label="文件或文件夹名称"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && validName) void finish();
                  }}
                />
              </label>
            )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => onAction(null)}
            >
              取消
            </Button>
            <Button
              disabled={
                busy ||
                (!["delete", "purge"].includes(action?.type ?? "") &&
                  !validName)
              }
              onClick={() => void finish()}
            >
              {busy ? "处理中…" : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(trashRoot)}
        onOpenChange={(open) => {
          if (!open) setTrashRoot(null);
        }}
      >
        <DialogContent>
          <DialogTitle>项目回收站</DialogTitle>
          <DialogDescription>
            {trashRoot} · 恢复不会覆盖原位置已有文件。
          </DialogDescription>
          <div className="max-h-80 overflow-auto space-y-2">
            {trash.length === 0 ? (
              <p className="text-sm">回收站为空。</p>
            ) : (
              trash.map((item) => (
                <div className="border rounded p-2 text-sm" key={item.id}>
                  <p className="break-all">{item.path}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        if (!trashRoot || busy) return;
                        setBusy(true);
                        try {
                          await workspaceFileRequest("restore", {
                            root: trashRoot,
                            id: item.id,
                          });
                          refreshFiles(trashRoot);
                          await loadTrash(trashRoot);
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      恢复 {item.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        trashRoot &&
                        onAction({
                          type: "purge",
                          root: trashRoot,
                          path: item.path,
                          id: item.id,
                          isDir: false,
                        })
                      }
                    >
                      永久删除 {item.name}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(uploadConflict)}
        onOpenChange={(open) => {
          if (!open) {
            conflictAnswer.current?.(null);
            setUploadConflict(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>上传目标已存在</DialogTitle>
          <DialogDescription>
            {uploadConflict?.path}{" "}
            已有文件。覆盖需要明确确认，编辑器中未保存的草稿会保留。
          </DialogDescription>
          <input
            className="session-file-input"
            aria-label="上传另存名称"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                uploadAbort.current?.abort();
                conflictAnswer.current?.(null);
              }}
            >
              取消上传
            </Button>
            <Button
              variant="outline"
              onClick={() => conflictAnswer.current?.(null)}
            >
              跳过
            </Button>
            <Button
              disabled={
                !uploadName.trim() ||
                /[\/\\]/.test(uploadName) ||
                uploadName === name(uploadConflict?.path ?? "")
              }
              variant="outline"
              onClick={() =>
                uploadConflict &&
                conflictAnswer.current?.({
                  path: join(parent(uploadConflict.path), uploadName.trim()),
                  overwrite: false,
                })
              }
            >
              另存名称
            </Button>
            <Button
              onClick={() =>
                uploadConflict &&
                conflictAnswer.current?.({
                  path: uploadConflict.path,
                  overwrite: true,
                })
              }
            >
              确认覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
