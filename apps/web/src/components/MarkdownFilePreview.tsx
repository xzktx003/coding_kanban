import { useDeferredValue } from "react";

import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";

export { normalizeLatexMathDelimiters } from "./markdown-latex";

export type MarkdownPreviewMode = "preview" | "edit" | "split";

interface MarkdownFilePreviewProps {
  content: string;
  dirty: boolean;
  mode: MarkdownPreviewMode;
  onContentChange: (content: string) => void;
  onModeChange: (mode: MarkdownPreviewMode) => void;
  onSave: () => void;
  saving: boolean;
}

const modeLabels: Array<{ mode: MarkdownPreviewMode; label: string }> = [
  { mode: "preview", label: "预览" },
  { mode: "edit", label: "编辑" },
  { mode: "split", label: "分屏" },
];

export function MarkdownFilePreview({
  content,
  dirty,
  mode,
  onContentChange,
  onModeChange,
  onSave,
  saving,
}: MarkdownFilePreviewProps) {
  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";
  const deferredPreviewContent = useDeferredValue(content);

  return (
    <div className={`markdown-file-preview markdown-file-preview--${mode}`}>
      <div className="markdown-file-preview-toolbar">
        <div
          aria-label="Markdown 显示模式"
          className="markdown-file-preview-modes"
          role="group"
        >
          {modeLabels.map((item) => (
            <button
              key={item.mode}
              aria-pressed={mode === item.mode}
              className={mode === item.mode ? "is-active" : ""}
              data-testid={`markdown-mode-${item.mode}`}
              onClick={() => onModeChange(item.mode)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="markdown-file-preview-status">
          {dirty && <span className="markdown-file-preview-dirty">未保存</span>}
          <button
            className="file-browser-pill"
            data-testid="save-markdown"
            disabled={!dirty || saving}
            onClick={onSave}
            type="button"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      <div className="markdown-file-preview-content">
        {showEditor && (
          <textarea
            aria-label="Markdown 源码编辑器"
            className="markdown-file-preview-editor"
            data-testid="markdown-editor"
            onChange={(event) => onContentChange(event.target.value)}
            spellCheck={false}
            value={content}
          />
        )}
        {showPreview && (
          <LazyMarkdownContent
            className="markdown-file-preview-rendered"
            content={deferredPreviewContent}
            fallbackClassName="markdown-file-preview-loading"
            fallbackTestId="markdown-render-loading"
            fallbackText="正在生成预览..."
          />
        )}
      </div>
    </div>
  );
}
