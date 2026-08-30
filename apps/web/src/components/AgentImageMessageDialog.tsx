import { useEffect, useRef, type FormEvent } from "react";

const MAX_CODEX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_CODEX_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface AgentImageMessageDialogProps {
  error: string | null;
  image: File;
  message: string;
  onCancel: () => void;
  onChooseAnother: () => void;
  onMessageChange: (message: string) => void;
  onSend: () => Promise<void> | void;
  previewUrl: string;
  sending: boolean;
  targetName: string;
}

export function extractClipboardImage(
  clipboardData: Pick<DataTransfer, "files"> &
    Partial<Pick<DataTransfer, "items">>,
): File | null {
  for (let index = 0; index < clipboardData.files.length; index += 1) {
    const file = clipboardData.files.item(index) ?? clipboardData.files[index];
    if (file?.type.startsWith("image/")) {
      return file;
    }
  }

  // Chromium can expose screenshots and copied web images only through
  // DataTransfer.items when the paste target is xterm's hidden textarea.
  // Resolve those browser-owned bytes before the shortcut reaches the remote
  // Codex TUI, which cannot access the user's local clipboard or X11 server.
  const items = clipboardData.items;
  for (let index = 0; index < (items?.length ?? 0); index += 1) {
    const item = items?.[index];
    if (item?.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }
  return null;
}

export function validateCodexImageFile(file: File): string | null {
  if (!SUPPORTED_CODEX_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "当前只支持 PNG、JPEG 或 WebP 图片";
  }
  if (file.size > MAX_CODEX_IMAGE_BYTES) {
    return "图片不能超过 10 MB";
  }
  if (file.size === 0) {
    return "图片内容为空，请重新选择";
  }
  return null;
}

function formatImageSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentImageMessageDialog({
  error,
  image,
  message,
  onCancel,
  onChooseAnother,
  onMessageChange,
  onSend,
  previewUrl,
  sending,
  targetName,
}: AgentImageMessageDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) {
          return;
        }
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || sending) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel, sending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSend();
  }

  return (
    <div
      className="agent-image-message-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) {
          onCancel();
        }
      }}
    >
      <section
        aria-describedby="agent-image-message-destination"
        aria-labelledby="agent-image-message-title"
        aria-modal="true"
        className="agent-image-message-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="agent-image-message-header">
          <div>
            <h2 id="agent-image-message-title">发送图片到 Codex</h2>
            <p id="agent-image-message-destination">
              将投递到 <strong>{targetName}</strong> 当前对应的对话
            </p>
          </div>
          <button
            aria-label="关闭图片发送窗口"
            className="agent-image-message-close"
            disabled={sending}
            onClick={onCancel}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>

        <form className="agent-image-message-form" onSubmit={handleSubmit}>
          <div className="agent-image-message-preview">
            <img alt="待发送图片预览" src={previewUrl} />
            <div className="agent-image-message-file-meta">
              <span title={image.name}>{image.name || "剪贴板图片"}</span>
              <span>{formatImageSize(image.size)}</span>
            </div>
          </div>

          <div className="agent-image-message-compose">
            <label htmlFor="agent-image-message-prompt">随图片发送的说明</label>
            <textarea
              autoFocus
              disabled={sending}
              id="agent-image-message-prompt"
              maxLength={8000}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="例如：请定位截图中的报错并给出修复方案"
              rows={6}
              value={message}
            />
            <p className="agent-image-message-hint">
              图片只临时保存到当前会话主机；若 CLI 需要通过路径读取，最多保留 24
              小时后自动清理。
            </p>
            {error && (
              <p className="agent-image-message-error" role="alert">
                {error}
              </p>
            )}
            <div className="agent-image-message-actions">
              <button
                className="agent-image-message-secondary"
                disabled={sending}
                onClick={onChooseAnother}
                type="button"
              >
                重新选择
              </button>
              <button
                className="agent-image-message-secondary"
                disabled={sending}
                onClick={onCancel}
                type="button"
              >
                取消
              </button>
              <button
                className="agent-image-message-primary"
                disabled={sending || message.trim().length === 0}
                type="submit"
              >
                {sending ? "正在发送…" : "发送到当前对话"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
