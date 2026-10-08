import { useState } from "react";
import { ComposerSheet } from "../codex/composer/v2/ComposerSheet";
import { Loader2, RotateCcw, X } from "lucide-react";
import { fileSrc } from "@session/hooks/runtime";
import type { useImageAttachments } from "./useImageAttachments";

export function ImageAttachmentStrip({
  draft,
  compact = false,
}: {
  compact?: boolean;
  draft: ReturnType<typeof useImageAttachments>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = draft.attachments.find((a) => a.id === selectedId);
  if (!draft.attachments.length && !draft.storageError) return null;
  if (compact)
    return (
      <>
        <div
          className="session-attachment-strip is-compact"
          aria-label="图片附件"
        >
          {draft.attachments.map((item) => (
            <div
              key={item.id}
              className="session-attachment"
              data-state={item.status}
            >
              <button
                type="button"
                aria-label={`预览 ${item.name}${item.status === "error" ? "，上传失败" : item.status === "uploading" ? "，上传中" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <img
                  src={
                    item.preview || (item.path ? fileSrc(item.path) : undefined)
                  }
                  alt={item.name}
                />
              </button>
              <button
                type="button"
                className="session-attachment-remove"
                aria-label={`移除 ${item.name}`}
                onClick={() => draft.remove(item.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {draft.storageError && (
            <button
              type="button"
              onClick={() => setSelectedId("storage")}
              aria-label="附件草稿保存失败，查看详情"
            >
              !
            </button>
          )}
        </div>
        {selectedId && (
          <ComposerSheet
            title={selected?.name ?? "附件草稿"}
            onClose={() => setSelectedId(null)}
          >
            {draft.storageError && (
              <p role="alert">
                附件草稿保存失败：{draft.storageError}
                <button type="button" onClick={draft.retryStorage}>
                  重试保存附件草稿
                </button>
              </p>
            )}
            {selected && (
              <>
                <img
                  className="session-context-image"
                  src={
                    selected.preview ||
                    (selected.path ? fileSrc(selected.path) : undefined)
                  }
                  alt={selected.name}
                />
                {selected.error && <p role="alert">{selected.error}</p>}
                <div className="session-context-actions">
                  {selected.status === "error" && (
                    <button
                      type="button"
                      onClick={() => void draft.retry(selected.id)}
                    >
                      重试上传
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      draft.remove(selected.id);
                      setSelectedId(null);
                    }}
                  >
                    移除
                  </button>
                </div>
              </>
            )}
          </ComposerSheet>
        )}
      </>
    );
  return (
    <div className="session-attachment-strip" aria-label="图片附件">
      {draft.storageError && (
        <span role="alert">
          附件草稿保存失败：{draft.storageError}{" "}
          <button type="button" onClick={draft.retryStorage}>
            重试保存附件草稿
          </button>
        </span>
      )}
      {draft.attachments.map((item) => (
        <div
          key={item.id}
          className="session-attachment"
          data-state={item.status}
        >
          <a
            href={item.preview || (item.path ? fileSrc(item.path) : undefined)}
            target="_blank"
            rel="noopener noreferrer"
            title={`预览 ${item.name}`}
          >
            <img
              src={item.preview || (item.path ? fileSrc(item.path) : undefined)}
              alt={item.name}
            />
          </a>
          <button
            type="button"
            className="session-attachment-remove"
            aria-label={`移除 ${item.name}`}
            onClick={() => draft.remove(item.id)}
          >
            <X size={13} />
          </button>
          <div className="session-attachment-caption">
            {item.status === "uploading" ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                上传中
              </>
            ) : item.status === "error" ? (
              <button
                type="button"
                title={item.error}
                onClick={() => draft.retry(item.id)}
              >
                <RotateCcw size={12} />
                重试
              </button>
            ) : (
              <span title={item.name}>{item.name}</span>
            )}
          </div>
          {item.status === "error" && (
            <span className="session-attachment-error" role="alert">
              {item.error}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
