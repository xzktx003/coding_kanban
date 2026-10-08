import { formatEditorContext } from "@session/services/editorContext";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { composerDrafts } from "@session/components/codex/composer/v2/drafts";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { buildUrl } from "@session/hooks/runtime";
import {
  readWorkspaceText,
  saveWorkspaceText,
} from "@session/services/workspaceFiles";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useInputStore } from "@session/stores";
import { useTodoStore } from "@session/stores/useTodoStore";
import { CodeEditor } from "../editor/CodeEditor";
import { OfficeView } from "./OfficeView";
import { OFFICE_EXTENSIONS } from "./officeFileTypes";
const extension = (path: string) =>
  path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
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
function localPath(source: string, path: string, root: string) {
  try {
    const target = new URL(source, "https://workspace.invalid" + path).pathname;
    return target === root || target.startsWith(root.replace(/\/$/, "") + "/")
      ? decodeURIComponent(target)
      : null;
  } catch {
    return null;
  }
}
export function FileViewer({ filePath }: { filePath: string }) {
  const root =
    useEditorStore((s) => s.roots[filePath]) ??
    useWorkspaceStore((s) => s.cwd) ??
    filePath.slice(0, filePath.lastIndexOf("/"));
  const doc = useFileDocumentStore((s) => s.documents[filePath]);
  const docs = useFileDocumentStore.getState();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [full, setFull] = useState(false),
    [mode, setMode] = useState<"edit" | "preview" | "both">("edit"),
    [reloadOpen, setReloadOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [storageError, setStorageError] = useState(false),
    [diskPreview, setDiskPreview] = useState("");
  const generation = useRef(0),
    savingRef = useRef(new Set<string>());
  const ext = extension(filePath),
    office = OFFICE_EXTENSIONS.includes(ext),
    image = images.includes(ext),
    markdown = ext === "md" || ext === "markdown";
  const setInput = useInputStore((s) => s.setInputValue),
    addTodo = useTodoStore((s) => s.addTodo);
  const load = useCallback(async () => {
    if (office || image) {
      setLoading(false);
      return;
    }
    const own = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await readWorkspaceText(root, filePath);
      if (own !== generation.current) return;
      if (typeof data.content !== "string" || typeof data.version !== "string")
        throw new Error("服务未返回有效的文件内容");
      useFileDocumentStore
        .getState()
        .load(filePath, root, data.content, data.version);
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (own === generation.current) setLoading(false);
    }
  }, [root, filePath, office, image]);
  useEffect(() => {
    setSaving(false);
    setError(null);
    setFull(false);
    void load();
    return () => {
      generation.current++;
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
    if (savingRef.current.has(filePath)) return;
    const own = generation.current;
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
      useFileDocumentStore.getState().saved(filePath, content, result.version);
      if (own === generation.current) setError(null);
    } catch (e) {
      if (own === generation.current && String(e).includes("已更新")) {
        try {
          const disk = await readWorkspaceText(current.root, filePath);
          if (own === generation.current) {
            useFileDocumentStore
              .getState()
              .load(filePath, current.root, disk.content, disk.version);
            setDiskPreview(disk.content);
          }
        } catch {}
      }
      throw e;
    } finally {
      savingRef.current.delete(filePath);
      if (own === generation.current) setSaving(false);
    }
  };
  if (office) return <OfficeView filePath={filePath} />;
  if (image)
    return (
      <div className="h-full overflow-auto p-3">
        <img
          alt={filePath.split("/").pop()}
          className="max-w-full object-contain"
          src={
            buildUrl("/workspace-files/asset") +
            "?" +
            new URLSearchParams({ root, path: filePath })
          }
        />
      </div>
    );
  const large = (doc?.base.split("\n").length ?? 0) > 500;
  const text = doc?.draft ?? "",
    display = large && !full ? text.split("\n").slice(0, 500).join("\n") : text;
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
                  const target = localPath(href, filePath, root);
                  if (target) useEditorStore.getState().openFile(target, root);
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
                    ? buildUrl("/workspace-files/asset") +
                      "?" +
                      new URLSearchParams({ root, path: target })
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
          (!large || full)
        ) {
          e.preventDefault();
          void save(doc.draft).catch((e) => setError(String(e)));
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
            disabled={saving || !doc || (large && !full)}
            onClick={() =>
              doc && void save(doc.draft).catch((e) => setError(String(e)))
            }
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
      {error && (
        <div role="alert" className="p-2 text-sm text-destructive">
          {doc ? "保存或读取失败，草稿已保留：" : "无法读取文件："}
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重新读取文件
          </Button>
        </div>
      )}
      {doc?.diskChanged && (
        <div role="status" className="session-file-conflict">
          磁盘文件已更新，当前草稿已保留。
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReloadOpen(true);
              void readWorkspaceText(root, filePath)
                .then((d) => setDiskPreview(d.content))
                .catch((e) => setError(String(e)));
            }}
          >
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
                <CodeEditor
                  key={filePath}
                  content={display}
                  filePath={filePath}
                  isReadOnly={large && !full}
                  onContentChange={(value) => docs.edit(filePath, value)}
                  onSave={save}
                  onSendToAI={(text, range) => {
                    const owner = activeDraftOwner();
                    if(JSON.parse(owner)[0]==="codex") {
                      composerDrafts.add(owner,{id:crypto.randomUUID(),kind:"file",name:filePath.split("/").pop()??filePath,path:filePath,text,...(range?{range}:{})});
                    } else useInputStore
                      .getState()
                      .appendInputValue(
                        formatEditorContext(filePath, text, range),
                      );
                  }}
                  onAddToTodo={addTodo}
                />
              </div>
              {markdown && mode !== "edit" && preview}
            </div>
            <div className="session-file-status">
              {doc.draft !== doc.base ? "未保存" : "已保存"} · {filePath}
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
      <Dialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <DialogContent>
          <DialogTitle>文件已在磁盘上更新</DialogTitle>
          <DialogDescription>
            重新读取将放弃当前未保存草稿。你也可以继续保留草稿，复制内容后再处理。
          </DialogDescription>
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
            <pre className="whitespace-pre-wrap text-xs">
              当前草稿：{doc?.draft}
            </pre>
            <pre className="whitespace-pre-wrap text-xs">
              磁盘内容：{diskPreview}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReloadOpen(false)}>
              保留草稿
            </Button>
            <Button
              onClick={() => {
                docs.discard(filePath);
                setReloadOpen(false);
                void load();
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
