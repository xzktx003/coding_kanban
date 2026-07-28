import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import {
  MarkdownFilePreview,
  type MarkdownPreviewMode,
} from "./MarkdownFilePreview";

const MARKDOWN_DIALOG_VIEWPORT_MARGIN = 24;
const MARKDOWN_DIALOG_MIN_WIDTH = 560;
const MARKDOWN_DIALOG_MIN_HEIGHT = 420;

interface MarkdownDialogSize {
  width: number;
  height: number;
}

interface MarkdownDialogResizeOrigin extends MarkdownDialogSize {
  pointerId: number;
  x: number;
  y: number;
}

export function clampMarkdownDialogSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): MarkdownDialogSize {
  const maxWidth = Math.max(0, viewportWidth - MARKDOWN_DIALOG_VIEWPORT_MARGIN);
  const maxHeight = Math.max(
    0,
    viewportHeight - MARKDOWN_DIALOG_VIEWPORT_MARGIN,
  );
  const minWidth = Math.min(MARKDOWN_DIALOG_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MARKDOWN_DIALOG_MIN_HEIGHT, maxHeight);

  return {
    width: Math.min(maxWidth, Math.max(minWidth, width)),
    height: Math.min(maxHeight, Math.max(minHeight, height)),
  };
}

interface MarkdownFileDialogProps {
  content: string;
  dirty: boolean;
  fileName: string;
  mode: MarkdownPreviewMode;
  onClose: () => void;
  onContentChange: (content: string) => void;
  onModeChange: (mode: MarkdownPreviewMode) => void;
  onSave: () => void;
  saving: boolean;
}

export function MarkdownFileDialog({
  content,
  dirty,
  fileName,
  mode,
  onClose,
  onContentChange,
  onModeChange,
  onSave,
  saving,
}: MarkdownFileDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const resizeOriginRef = useRef<MarkdownDialogResizeOrigin | null>(null);

  function applyDialogSize(width: number, height: number) {
    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return;
    }

    const viewportHeight =
      window.visualViewport?.height ?? document.documentElement.clientHeight;
    const size = clampMarkdownDialogSize(
      width,
      height,
      document.documentElement.clientWidth,
      viewportHeight,
    );
    dialogElement.style.width = `${size.width}px`;
    dialogElement.style.height = `${size.height}px`;
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return;
    }

    const bounds = dialogElement.getBoundingClientRect();
    resizeOriginRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleResizePointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const origin = resizeOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) {
      return;
    }

    applyDialogSize(
      origin.width + event.clientX - origin.x,
      origin.height + event.clientY - origin.y,
    );
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeOriginRef.current?.pointerId !== event.pointerId) {
      return;
    }

    resizeOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const dialog = (
    <div
      className="file-browser-modal file-browser-modal--markdown"
      data-testid="markdown-file-dialog"
    >
      <div
        className="file-browser-dialog file-browser-dialog--markdown"
        data-resizable="true"
        ref={dialogRef}
      >
        <div className="markdown-file-dialog-header">
          <div>
            <span className="markdown-file-dialog-kicker">Markdown</span>
            <h3>{fileName}</h3>
          </div>
          <button
            aria-label="关闭 Markdown 文件窗口"
            className="markdown-file-dialog-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <MarkdownFilePreview
          content={content}
          dirty={dirty}
          mode={mode}
          onContentChange={onContentChange}
          onModeChange={onModeChange}
          onSave={onSave}
          saving={saving}
        />
        <button
          aria-label="调整 Markdown 窗口大小"
          className="markdown-file-dialog-resizer"
          data-testid="markdown-dialog-resizer"
          onPointerCancel={handleResizePointerEnd}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          tabIndex={-1}
          type="button"
        />
      </div>
    </div>
  );

  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}
