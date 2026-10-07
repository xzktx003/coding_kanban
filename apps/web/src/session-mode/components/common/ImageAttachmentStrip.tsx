import { Loader2, RotateCcw, X } from "lucide-react";
import { fileSrc } from "@session/hooks/runtime";
import type { useImageAttachments } from "./useImageAttachments";

export function ImageAttachmentStrip({
  draft,
}: {
  draft: ReturnType<typeof useImageAttachments>;
}) {
  if (!draft.attachments.length && !draft.storageError) return null;
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
