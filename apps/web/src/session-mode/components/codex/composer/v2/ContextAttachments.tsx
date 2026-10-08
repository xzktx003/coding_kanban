import { useState } from "react";
import { FileText, Image, Quote, X, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ComposerContext } from "@agent-orchestrator/shared";
import { readTextFile } from "@session/services/apiAdapt/filesystem";
import { fileSrc } from "@session/hooks/runtime";
import type {
  useImageAttachments,
  ImageAttachment,
} from "@session/components/common/useImageAttachments";
import { composerDrafts, useComposerDraft } from "./drafts";
import { ComposerSheet } from "./ComposerSheet";
import { offerUndo } from "./UndoNotice";

export async function addFileContexts(owner: string, paths: string[]) {
  for (const path of paths) {
    const text = await readTextFile(path, { suppressToast: true });
    if (typeof text !== "string" || text.includes("\0"))
      throw new Error("请选择文本文件，图片请通过图片入口添加");
    if (text.length > 180_000)
      throw new Error("文件过长，请在文件编辑器中选择需要的片段后引用");
    composerDrafts.add(owner, {
      id: crypto.randomUUID(),
      kind: "file",
      name: path.split("/").pop() ?? path,
      path,
      text,
    });
  }
}
export function ContextAttachments({
  owner,
  images,
  onAnnotate,
  onRestore,
  compact = false,
}: {
  compact?: boolean;
  owner: string;
  images: ReturnType<typeof useImageAttachments>;
  onAnnotate: (item: ImageAttachment) => void;
  onRestore: (text: string) => void;
}) {
  const { contexts } = useComposerDraft(owner);
  const [panel, setPanel] = useState<string | null>(null),
    [checking, setChecking] = useState(false),
    [changed, setChanged] = useState<Record<string, string>>({});
  const selected = contexts.find((c) => c.id === panel);
  const count = contexts.length + images.attachments.length;
  const remove = (c: ComposerContext) => {
    offerUndo("已移除上下文", composerDrafts.remove(owner, c.id));
    if (panel === c.id) setPanel(null);
  };
  const removeImage = (id: string) => {
    offerUndo("已移除图片", images.removeUndoable(id));
    if (panel === id) setPanel(null);
  };
  async function checkFile(c: ComposerContext) {
    if (!c.path) return;
    setChecking(true);
    try {
      const all = await readTextFile(c.path, { suppressToast: true });
      const text = c.range
        ? all
            .split(/\r?\n/)
            .slice(c.range.start - 1, c.range.end)
            .join("\n")
        : all;
      if (text === c.text) {
        setChanged((s) => {
          const next = { ...s };
          delete next[c.id];
          return next;
        });
        toast.success("源文件内容未变化");
      } else setChanged((s) => ({ ...s, [c.id]: text }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setChecking(false);
    }
  }
  const details = (c: ComposerContext) => (
    <>
      <div className="session-context-source">
        {c.path ??
          (c.sourceThreadId ? `会话：${c.sourceThreadId}` : "粘贴的完整文本")}
        {c.range && ` · L${c.range.start}–${c.range.end}`}
      </div>
      <pre className="session-context-preview">{c.text}</pre>
      <div className="session-context-actions">
        <button type="button" onClick={() => remove(c)}>
          移除
        </button>
        {c.kind === "paste" && (
          <button
            type="button"
            onClick={() => {
              onRestore(c.text);
              composerDrafts.remove(owner, c.id);
              setPanel(null);
            }}
          >
            还原到输入框
          </button>
        )}
        {c.path && (
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkFile(c)}
          >
            {checking ? "正在检查…" : "检查源文件更新"}
          </button>
        )}
      </div>
      {changed[c.id] !== undefined && (
        <div role="status" className="session-context-warning">
          源文件已变化；本次仍引用已保存的快照。
          <button
            type="button"
            onClick={() => {
              const next = {
                ...c,
                id: crypto.randomUUID(),
                text: changed[c.id],
              };
              composerDrafts.replace(owner, c.id, next);
              setPanel(next.id);
            }}
          >
            更新为最新内容
          </button>
        </div>
      )}
    </>
  );
  return (
    <>
      {images.storageError && !compact && (
        <div role="alert">
          附件草稿保存失败：{images.storageError}
          <button type="button" onClick={images.retryStorage}>
            重试保存附件草稿
          </button>
        </div>
      )}
      {!!count && (
        <div
          className={`session-context-strip ${compact ? "is-compact" : ""}`}
          aria-label="本次消息的附件与上下文"
        >
          {contexts.map((c) => (
            <div className="session-context-chip" key={c.id}>
              <button
                type="button"
                aria-label={`查看上下文 ${c.name} ${c.range ? `L${c.range.start}–${c.range.end}` : c.kind === "paste" ? `${c.text.split(/\r?\n/).length} 行 · 完整内容` : c.kind === "quote" ? "回答引用" : "文件快照"}`}
                onClick={() => setPanel(c.id)}
              >
                {c.kind === "quote" ? <Quote /> : <FileText />}
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.range
                      ? `L${c.range.start}–${c.range.end}`
                      : c.kind === "paste"
                        ? `${c.text.split(/\r?\n/).length} 行 · 完整内容`
                        : c.kind === "quote"
                          ? "回答引用"
                          : "文件快照"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                aria-label={`移除 ${c.name}`}
                onClick={() => remove(c)}
              >
                <X />
              </button>
            </div>
          ))}
          {images.attachments.map((a) => (
            <div
              className="session-context-chip is-image"
              key={a.id}
              data-state={a.status}
            >
              <button
                type="button"
                aria-label={`预览 ${a.name}${a.status === "uploading" ? "，上传中" : a.status === "error" ? "，上传失败" : ""}`}
                onClick={() => setPanel(a.id)}
              >
                <img
                  src={a.preview || (a.path ? fileSrc(a.path) : undefined)}
                  alt=""
                />
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.status === "uploading"
                      ? "上传中…"
                      : a.status === "error"
                        ? "上传失败，点击重试"
                        : a.drawing
                          ? "已标注 · 可编辑"
                          : "图片"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                aria-label={`移除 ${a.name}`}
                onClick={() => removeImage(a.id)}
              >
                <X />
              </button>
            </div>
          ))}
          {(!compact || count > 1) && (
            <button
              type="button"
              className="session-context-all"
              onClick={() => setPanel("all")}
            >
              {compact ? `${count} 项` : `查看全部 ${count} 项`}
            </button>
          )}
        </div>
      )}
      {panel && (
        <ComposerSheet
          title={selected?.name ?? "附件与上下文"}
          description="内容快照会随本次消息提交，切换会话时独立保留。"
          onClose={() => setPanel(null)}
        >
          {images.storageError && (
            <p role="alert">
              附件草稿保存失败：{images.storageError}
              <button type="button" onClick={images.retryStorage}>
                重试保存附件草稿
              </button>
            </p>
          )}
          {selected ? (
            details(selected)
          ) : (
            <div className="session-context-list">
              {contexts.map((c) => (
                <section key={c.id}>
                  <button
                    type="button"
                    aria-label={`查看上下文 ${c.name} ${c.range ? `L${c.range.start}–${c.range.end}` : c.kind === "paste" ? `${c.text.split(/\r?\n/).length} 行 · 完整内容` : c.kind === "quote" ? "回答引用" : "文件快照"}`}
                    onClick={() => setPanel(c.id)}
                  >
                    <FileText />
                    {c.name}
                  </button>
                  <small>
                    {c.path ??
                      (c.kind === "quote" ? "引用的回答" : "粘贴的文本")}
                  </small>
                </section>
              ))}
              {images.attachments
                .filter((a) => panel === "all" || panel === a.id)
                .map((a) => (
                  <section key={a.id}>
                    <img
                      className="session-context-image"
                      src={a.preview || (a.path ? fileSrc(a.path) : undefined)}
                      alt={a.name}
                    />
                    <strong>{a.name}</strong>
                    {a.error && <p role="alert">{a.error}</p>}
                    <div className="session-context-actions">
                      <button type="button" onClick={() => removeImage(a.id)}>
                        <X />
                        移除
                      </button>
                      {a.status === "error" && (
                        <button
                          type="button"
                          onClick={() => void images.retry(a.id)}
                        >
                          <RotateCcw />
                          重试上传
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={a.status !== "ready"}
                        onClick={() => {
                          setPanel(null);
                          onAnnotate(a);
                        }}
                      >
                        <Pencil />
                        标注图片
                      </button>
                    </div>
                  </section>
                ))}
            </div>
          )}
        </ComposerSheet>
      )}
    </>
  );
}
