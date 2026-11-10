import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { formatEditorContext } from "@session/services/editorContext";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { addBrowserEditorContext } from "@session/features/codex-host/bridge";
import { isCodexDraftOwner } from "@session/components/codex/composer/v2/selectionAnnotations";
import { useCodexStore } from "@session/components/codex/stores";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@session/components/ui/dialog";
import { useDirWatch } from "@session/hooks/useDirWatch";
import { buildEventUrl } from "@session/hooks/runtime";
import {
  readWorkspaceText,
  saveWorkspaceText,
  type TextSnapshot,
} from "@session/services/workspaceFiles";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import {
  useFileDocumentStore,
  type FileDocument,
} from "@session/stores/useFileDocumentStore";
import {
  clearFileSaveFailure,
  hasPendingFileOperation,
  useFileSaveStatusStore,
} from "@session/stores/useFileSaveStatusStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useInputStore } from "@session/stores";
import { useTodoStore } from "@session/stores/useTodoStore";
import { CodeEditor } from "../editor/CodeEditor";
import { EditorGitBlame } from "../editor/EditorGitBlame";
import { OFFICE_EXTENSIONS } from "./officeFileTypes";
const OfficeView = lazy(() =>
  import("./OfficeView").then((module) => ({ default: module.OfficeView })),
);
const extension = (path: string) =>
  path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
const FILE_READ_TIMEOUT_MS = 15_000;
const fileReadError = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "name" in error &&
  error.name === "TimeoutError"
    ? "读取文件超时，请重试"
    : error instanceof Error
      ? error.message
      : String(error);
const images = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
  "bmp",
  "ico",
];
function localPath(
  source: string,
  path: string,
  root: string,
  allowOutside = false,
) {
  try {
    const target = new URL(source, "https://workspace.invalid" + path).pathname;
    return allowOutside ||
      target === root ||
      target.startsWith(root.replace(/\/$/, "") + "/")
      ? decodeURIComponent(target)
      : null;
  } catch {
    return null;
  }
}
export function FileViewer({ filePath }: { filePath: string }) {
  const registeredRoot = useEditorStore((s) => s.roots[filePath]);
  const workspaceRoot = useWorkspaceStore((s) => s.cwd);
  const root =
    registeredRoot ??
    workspaceRoot ??
    filePath.slice(0, filePath.lastIndexOf("/"));
  const doc = useFileDocumentStore((s) => s.documents[filePath]);
  const savePending = useFileSaveStatusStore((s) => s.pending.has(filePath));
  const operationPending = useFileSaveStatusStore((s) =>
    hasPendingFileOperation(s.operations, filePath),
  );
  const saveFailure = useFileSaveStatusStore((s) => s.failures.get(filePath));
  const reveal = useEditorStore((s) => s.revealLocation);
  const docs = useFileDocumentStore.getState();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [contextError, setContextError] = useState<string | null>(null),
    [full, setFull] = useState(false),
    [mode, setMode] = useState<"edit" | "preview" | "both">("edit"),
    [reloadOpen, setReloadOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [storageError, setStorageError] = useState(false),
    [diskPreview, setDiskPreview] = useState<TextSnapshot | null>(null),
    [compareLoading, setCompareLoading] = useState(false),
    [compareError, setCompareError] = useState<string | null>(null);
  const generation = useRef(0),
    ownerGeneration = useRef(0),
    ownerAbort = useRef<AbortController | null>(null),
    loadAbort = useRef<AbortController | null>(null),
    compareGeneration = useRef(0),
    compareAbort = useRef<AbortController | null>(null),
    savingRef = useRef(new Set<string>());
  const ext = extension(filePath),
    office = OFFICE_EXTENSIONS.includes(ext),
    image = images.includes(ext),
    markdown = ext === "md" || ext === "markdown";
  const setInput = useInputStore((s) => s.setInputValue),
    addTodo = useTodoStore((s) => s.addTodo);
  const readDisk = useCallback(
    async (signal: AbortSignal) => {
      const data = await readWorkspaceText(root, filePath, { signal });
      if (
        !data ||
        typeof data.content !== "string" ||
        typeof data.version !== "string"
      )
        throw new Error("服务未返回有效的文件内容");
      return data;
    },
    [root, filePath],
  );
  const load = useCallback(async () => {
    if (office || image) {
      setLoading(false);
      return;
    }
    const own = ++generation.current;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await readWithDeadline(
        readDisk,
        FILE_READ_TIMEOUT_MS,
        controller.signal,
      );
      if (own !== generation.current) return;
      useFileDocumentStore
        .getState()
        .load(filePath, root, data.content, data.version);
    } catch (e) {
      if (own === generation.current) setError(fileReadError(e));
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
      if (own === generation.current) setLoading(false);
    }
  }, [root, filePath, office, image, readDisk]);
  useEffect(() => {
    ownerGeneration.current++;
    const controller = new AbortController();
    ownerAbort.current = controller;
    setSaving(false);
    setError(null);
    setFull(false);
    setContextError(null);
    setReloadOpen(false);
    setDiskPreview(null);
    setCompareError(null);
    setCompareLoading(false);
    void load();
    return () => {
      generation.current++;
      ownerGeneration.current++;
      compareGeneration.current++;
      controller.abort();
      loadAbort.current?.abort();
      compareAbort.current?.abort();
      if (ownerAbort.current === controller) ownerAbort.current = null;
    };
  }, [load]);
  useEffect(() => {
    const fail = () => setStorageError(true);
    window.addEventListener("file-draft-storage-error", fail);
    return () => window.removeEventListener("file-draft-storage-error", fail);
  }, []);
  useDirWatch(
    !office && !image ? filePath.slice(0, filePath.lastIndexOf("/")) : null,
    (event) => {
      if (event.path === filePath) void load();
    },
  );
  const save = async (content: string) => {
    if (savingRef.current.has(filePath))
      throw new Error("此文件正在保存，请等待当前结果后再试。");
    const own = ownerGeneration.current;
    const ownerSignal = ownerAbort.current?.signal;
    const current = useFileDocumentStore.getState().documents[filePath];
    if (!current) throw new Error("文件尚未加载");
    savingRef.current.add(filePath);
    setSaving(true);
    try {
      const result = await saveWorkspaceText(
        current.root,
        filePath,
        content,
        current.version,
      );
      const refreshAfterSave =
        own === ownerGeneration.current && loadAbort.current !== null;
      if (refreshAfterSave) {
        // A watch read started before the save acknowledgement can contain
        // the old disk version. Replace it with a fresh read after the save.
        generation.current++;
        loadAbort.current?.abort();
        loadAbort.current = null;
        setLoading(false);
      }
      useFileDocumentStore.getState().saved(filePath, content, result.version);
      if (own === ownerGeneration.current) {
        setError(null);
        if (refreshAfterSave) void load();
      }
    } catch (e) {
      if (own === ownerGeneration.current)
        setError(e instanceof Error ? e.message : String(e));
      if (own === ownerGeneration.current && String(e).includes("已更新")) {
        try {
          const disk = await readWithDeadline(
            (signal) => readWorkspaceText(current.root, filePath, { signal }),
            FILE_READ_TIMEOUT_MS,
            ownerSignal,
          );
          if (own === ownerGeneration.current) {
            useFileDocumentStore
              .getState()
              .load(filePath, current.root, disk.content, disk.version);
          }
        } catch {}
      }
      throw e;
    } finally {
      savingRef.current.delete(filePath);
      if (own === ownerGeneration.current) setSaving(false);
    }
  };
  const saveFromViewer = (content: string) => {
    const own = ownerGeneration.current;
    void save(content).catch((error) => {
      if (own === ownerGeneration.current) setError(String(error));
    });
  };
  const closeComparison = () => {
    compareGeneration.current++;
    compareAbort.current?.abort();
    compareAbort.current = null;
    setCompareLoading(false);
    setCompareError(null);
    setDiskPreview(null);
    setReloadOpen(false);
  };
  const openComparison = () => {
    setReloadOpen(true);
    setDiskPreview(null);
    void readComparison();
  };
  const readComparison = async (confirmed?: {
    preview: TextSnapshot;
    draft: FileDocument;
  }) => {
    const own = ++compareGeneration.current;
    const owner = ownerGeneration.current;
    compareAbort.current?.abort();
    const controller = new AbortController();
    compareAbort.current = controller;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const disk = await readWithDeadline(
        readDisk,
        FILE_READ_TIMEOUT_MS,
        controller.signal,
      );
      if (
        own !== compareGeneration.current ||
        owner !== ownerGeneration.current
      )
        return;
      if (!confirmed) {
        setDiskPreview(disk);
      } else if (
        disk.path !== confirmed.preview.path ||
        disk.version !== confirmed.preview.version ||
        disk.content !== confirmed.preview.content
      ) {
        setDiskPreview(disk);
        setCompareError("磁盘内容再次变化，请检查后重新确认。");
      } else {
        // A watch-triggered read may have started before this confirmation.
        // Its late result must not replace the freshly confirmed snapshot.
        const refreshAfterComparison = loadAbort.current !== null;
        generation.current++;
        loadAbort.current?.abort();
        loadAbort.current = null;
        setLoading(false);
        if (
          confirmed.draft.root !== root ||
          !useFileDocumentStore
            .getState()
            .replaceIfUnchanged(
              filePath,
              confirmed.draft,
              disk.content,
              disk.version,
            )
        ) {
          setCompareError(
            "草稿在读取期间发生变化，已保留当前内容，请检查后重新确认。",
          );
        } else {
          setError(null);
          clearFileSaveFailure(filePath);
          closeComparison();
        }
        if (refreshAfterComparison) void load();
      }
    } catch (error) {
      if (
        own === compareGeneration.current &&
        owner === ownerGeneration.current
      )
        setCompareError(`读取磁盘内容失败：${fileReadError(error)}`);
    } finally {
      if (compareAbort.current === controller) compareAbort.current = null;
      if (
        own === compareGeneration.current &&
        owner === ownerGeneration.current
      )
        setCompareLoading(false);
    }
  };
  if (office)
    return (
      <Suspense
        fallback={
          <div role="status" className="p-4 text-sm text-muted-foreground">
            正在加载文档预览…
          </div>
        }
      >
        <OfficeView filePath={filePath} />
      </Suspense>
    );
  if (image)
    return (
      <div className="h-full overflow-auto p-3">
        <img
          alt={filePath.split("/").pop()}
          className="max-w-full object-contain"
          src={buildEventUrl(
            (root === "/" ? "/local-files/asset?" : "/workspace-files/asset?") +
              new URLSearchParams({ root, path: filePath }).toString(),
          )}
        />
      </div>
    );
  const large = (doc?.base.split("\n").length ?? 0) > 500;
  const revealBeyondPreview =
    reveal?.path === filePath &&
    reveal.endLine !== undefined &&
    reveal.endLine > 500;
  const text = doc?.draft ?? "",
    display =
      large && !full && !revealBeyondPreview
        ? text.split("\n").slice(0, 500).join("\n")
        : text;
  const preview = (
    <div
      className="session-file-markdown overflow-auto p-4 h-full"
      data-markdown-preview
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              onClick={(e) => {
                if (href && !/^(https?:|mailto:|#)/i.test(href)) {
                  e.preventDefault();
                  const target = localPath(href, filePath, root, true);
                  if (target)
                    void openWorkspaceFileReference({ path: target }, root);
                }
              }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const target =
              src && !/^https?:/i.test(src)
                ? localPath(src, filePath, root)
                : null;
            return (
              <img
                alt={alt ?? ""}
                src={
                  target
                    ? buildEventUrl(
                        (root === "/"
                          ? "/local-files/asset?"
                          : "/workspace-files/asset?") +
                          new URLSearchParams({
                            root,
                            path: target,
                          }).toString(),
                      )
                    : /^https?:/i.test(src ?? "")
                      ? src
                      : undefined
                }
              />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
  return (
    <div
      className="flex flex-col h-full min-h-0 min-w-0"
      onKeyDownCapture={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "s" &&
          !e.defaultPrevented &&
          doc &&
          !reloadOpen &&
          (!large || full)
        ) {
          e.preventDefault();
          if (!savePending && !operationPending) saveFromViewer(doc.draft);
        }
      }}
    >
      {markdown && (
        <div className="session-file-view-switch">
          <span>Markdown</span>
          {(["edit", "preview", "both"] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {["源码", "预览", "左右对照"][i]}
            </button>
          ))}
          <Button
            size="sm"
            disabled={
              saving ||
              savePending ||
              operationPending ||
              !doc ||
              (large && !full)
            }
            onClick={() => doc && saveFromViewer(doc.draft)}
          >
            保存
          </Button>
        </div>
      )}
      {storageError && (
        <div role="alert" className="p-2 text-sm text-destructive">
          浏览器草稿存储空间不足，请保存文件或复制草稿；当前文字仍在内存中。
        </div>
      )}
      {savePending && (
        <div role="status" className="p-2 text-sm text-muted-foreground">
          文件正在保存，可以继续编辑；当前结果返回前不能再次保存。
        </div>
      )}
      {operationPending && (
        <div role="status" className="p-2 text-sm text-muted-foreground">
          文件正在移动、重命名或删除，操作完成前不能保存。
        </div>
      )}
      {saveFailure && !error && (
        <div role="alert" className="p-2 text-sm text-destructive">
          上次保存未确认：{saveFailure}。请检查磁盘内容和草稿。
          <Button variant="outline" size="sm" onClick={openComparison}>
            比较磁盘内容
          </Button>
        </div>
      )}
      {doc?.saveUnconfirmed && !savePending && !saveFailure && !error && (
        <div role="alert" className="p-2 text-sm text-destructive">
          上次保存的结果尚未确认，之前的写入可能仍在进行。请核对磁盘内容和草稿。
          <Button variant="outline" size="sm" onClick={openComparison}>
            比较磁盘内容
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="p-2 text-sm text-destructive">
          {doc ? "保存或读取失败，草稿已保留：" : "无法读取文件："}
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重新读取文件
          </Button>
        </div>
      )}
      {contextError && (
        <div role="alert" className="p-2 text-sm text-destructive">
          未添加到输入区：{contextError}
        </div>
      )}
      {doc?.diskChanged && (
        <div role="status" className="session-file-conflict">
          磁盘文件已更新，当前草稿已保留。
          <Button size="sm" variant="outline" onClick={openComparison}>
            比较并重新读取
          </Button>
        </div>
      )}
      {loading && !doc ? (
        <div role="status" className="p-4">
          正在加载文件…
        </div>
      ) : (
        doc && (
          <>
            <div
              className={`session-file-edit-preview ${mode === "both" && markdown ? "is-split" : ""}`}
            >
              <div
                className="min-w-0 min-h-0 h-full"
                hidden={markdown && mode === "preview"}
                inert={markdown && mode === "preview"}
              >
                <EditorGitBlame cwd={root} filePath={filePath} />
                <CodeEditor
                  key={filePath}
                  content={display}
                  filePath={filePath}
                  isReadOnly={large && !full}
                  savePending={savePending || operationPending}
                  saveErrorHandledByParent
                  onContentChange={(value) => docs.edit(filePath, value)}
                  onSave={save}
                  onSendToAI={(text, range, annotation) => {
                    // Resolve the input owner at this deliberate action, then keep its identity immutable.
                    const draftOwner = activeDraftOwner();
                    try {
                      if (isCodexDraftOwner(draftOwner)) {
                        const state = useCodexStore.getState();
                        const workspace = useWorkspaceStore.getState().cwd;
                        if (
                          draftOwner !==
                          sessionDraftKey(
                            "codex",
                            state.currentThreadId,
                            workspace,
                          )
                        )
                          throw new Error(
                            "输入目标已改变，请重新选择原会话项目。",
                          );
                        const threadId = state.currentThreadId;
                        const cwd = threadId
                          ? state.threads.find(
                              (thread) => thread.id === threadId,
                            )?.cwd
                          : workspace;
                        if (!cwd?.trim())
                          throw new Error(
                            "原会话项目目录尚未确认，请加载该会话后重试。",
                          );
                        const aliases = useVsCodePanelStore.getState().aliases;
                        const canonicalRoot = aliases[root] ?? root;
                        if (canonicalRoot !== (aliases[cwd] ?? cwd))
                          throw new Error(
                            "文件不属于当前输入的原会话项目，请选择对应会话后重试。",
                          );
                        const path =
                          canonicalRoot !== root &&
                          filePath.startsWith(root.replace(/\/$/, "") + "/")
                            ? canonicalRoot.replace(/\/$/, "") +
                              filePath.slice(root.replace(/\/$/, "").length)
                            : filePath;
                        const owner = Object.freeze({
                          cwd,
                          threadId,
                          draftOwner,
                        });
                        const attached = addBrowserEditorContext(
                          owner,
                          {
                            path,
                            text,
                            ...(range ? { range: { ...range } } : {}),
                          },
                          annotation,
                        );
                        setContextError(null);
                        return attached;
                      } else
                        useInputStore
                          .getState()
                          .appendInputValue(
                            formatEditorContext(filePath, text, range) +
                              (annotation?.trim()
                                ? `\n\n用户评论：\n${annotation.trim()}`
                                : ""),
                          );
                      setContextError(null);
                    } catch (error) {
                      setContextError(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  }}
                  onAddToTodo={addTodo}
                />
              </div>
              {markdown && mode !== "edit" && preview}
            </div>
            <div className="session-file-status">
              {savePending
                ? "保存中"
                : doc.saveUnconfirmed
                  ? "保存结果未确认"
                  : doc.draft !== doc.base
                    ? "未保存"
                    : "已保存"}{" "}
              · {filePath}
              {large && !full && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFull(true)}
                >
                  加载全文以编辑
                </Button>
              )}
            </div>
          </>
        )
      )}
      <Dialog
        open={reloadOpen}
        onOpenChange={(open) => {
          if (!open) closeComparison();
        }}
      >
        <DialogContent>
          <DialogTitle>
            {doc?.diskChanged ? "文件已在磁盘上更新" : "核对保存结果"}
          </DialogTitle>
          <DialogDescription>
            重新读取将放弃当前未保存草稿。你也可以继续保留草稿，复制内容后再处理。
            {doc?.saveUnconfirmed &&
              " 之前的保存可能仍在进行，重新读取不代表它已停止。"}
          </DialogDescription>
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
            <pre className="whitespace-pre-wrap text-xs">
              当前草稿：{doc?.draft}
            </pre>
            <pre className="whitespace-pre-wrap text-xs">
              磁盘内容：{diskPreview?.content ?? ""}
            </pre>
          </div>
          {compareLoading && <div role="status">正在读取磁盘内容…</div>}
          {compareError && (
            <div role="alert" className="text-sm text-destructive">
              {compareError}
            </div>
          )}
          {!diskPreview && !compareLoading && (
            <Button variant="outline" onClick={() => void readComparison()}>
              重试读取磁盘内容
            </Button>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeComparison}>
              保留草稿
            </Button>
            <Button
              disabled={
                !diskPreview ||
                compareLoading ||
                saving ||
                savePending ||
                operationPending
              }
              onClick={() => {
                const draft =
                  useFileDocumentStore.getState().documents[filePath];
                if (diskPreview && draft)
                  void readComparison({ preview: diskPreview, draft });
              }}
            >
              放弃草稿并重新读取
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
