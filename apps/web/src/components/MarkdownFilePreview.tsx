import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";

import {
  calculateSyncedScrollTop,
  extractMarkdownHeadings,
  MARKDOWN_OUTLINE_ITEM_LIMIT,
} from "../lib/markdown-navigation";
import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";
import type { MarkdownResourceContext } from "./MarkdownImage";

export { normalizeLatexMathDelimiters } from "./markdown-latex";

export type MarkdownPreviewMode = "preview" | "edit" | "split";

interface MarkdownFilePreviewProps {
  content: string;
  dirty: boolean;
  loading?: boolean;
  mode: MarkdownPreviewMode;
  onContentChange: (content: string) => void;
  onModeChange: (mode: MarkdownPreviewMode) => void;
  onSave: () => void;
  readOnly?: boolean;
  resourceContext?: MarkdownResourceContext;
  saving: boolean;
  showNavigation?: boolean;
  windowNavigation?: {
    label: string;
    loading: boolean;
    nextAvailable: boolean;
    onNext: () => void;
    onPrevious: () => void;
    previousAvailable: boolean;
  };
}

const modeLabels: Array<{ mode: MarkdownPreviewMode; label: string }> = [
  { mode: "preview", label: "预览" },
  { mode: "edit", label: "编辑" },
  { mode: "split", label: "分屏" },
];

export function MarkdownFilePreview({
  content,
  dirty,
  loading = false,
  mode,
  onContentChange,
  onModeChange,
  onSave,
  readOnly = false,
  resourceContext,
  saving,
  showNavigation = true,
  windowNavigation,
}: MarkdownFilePreviewProps) {
  const editorReadOnly = readOnly || loading;
  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";
  const deferredPreviewContent = useDeferredValue(content);
  const headings = useMemo(
    () => extractMarkdownHeadings(deferredPreviewContent),
    [deferredPreviewContent],
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const renderedRef = useRef<HTMLElement>(null);
  const scrollOwnerRef = useRef<"editor" | "preview" | null>(null);
  const releaseScrollFrameRef = useRef<number | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const synchronizePane = useCallback(
    (
      sourceKind: "editor" | "preview",
      source: HTMLElement,
      target: HTMLElement | null,
    ) => {
      if (!syncScroll || mode !== "split" || !target) return;
      if (
        scrollOwnerRef.current !== null &&
        scrollOwnerRef.current !== sourceKind
      ) {
        return;
      }

      scrollOwnerRef.current = sourceKind;
      target.scrollTop = calculateSyncedScrollTop({
        sourceScrollTop: source.scrollTop,
        sourceScrollHeight: source.scrollHeight,
        sourceClientHeight: source.clientHeight,
        targetScrollHeight: target.scrollHeight,
        targetClientHeight: target.clientHeight,
      });

      if (releaseScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(releaseScrollFrameRef.current);
      }
      releaseScrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollOwnerRef.current = null;
        releaseScrollFrameRef.current = null;
      });
    },
    [mode, syncScroll],
  );

  useEffect(
    () => () => {
      if (releaseScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(releaseScrollFrameRef.current);
      }
    },
    [],
  );

  const handleEditorScroll = useCallback(
    (event: UIEvent<HTMLTextAreaElement>) => {
      synchronizePane("editor", event.currentTarget, renderedRef.current);
    },
    [synchronizePane],
  );

  const handlePreviewScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      synchronizePane("preview", event.currentTarget, editorRef.current);
    },
    [synchronizePane],
  );

  function jumpToHeading(id: string) {
    const scroller = renderedRef.current;
    const heading = scroller?.querySelector<HTMLElement>(`#${id}`);
    if (!scroller || !heading) return;

    const scrollerBox = scroller.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    scroller.scrollTo({
      top: scroller.scrollTop + headingBox.top - scrollerBox.top - 12,
    });
    setActiveHeadingId(id);
  }

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
              disabled={loading || (readOnly && item.mode === "edit")}
              onClick={() => onModeChange(item.mode)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="markdown-file-preview-status">
          {showPreview && showNavigation && (
            <button
              aria-expanded={outlineOpen}
              className="file-browser-pill"
              onClick={() => setOutlineOpen((open) => !open)}
              type="button"
            >
              {outlineOpen ? "收起目录" : "目录"}
            </button>
          )}
          {mode === "split" && (
            <button
              aria-pressed={syncScroll}
              className="file-browser-pill"
              data-testid="markdown-sync-scroll"
              onClick={() => setSyncScroll((enabled) => !enabled)}
              type="button"
            >
              {syncScroll ? "同步滚动" : "独立滚动"}
            </button>
          )}
          {readOnly && (
            <span className="markdown-file-preview-readonly">分段预览只读</span>
          )}
          {loading && (
            <span className="markdown-file-preview-readonly">
              正在读取完整窗口...
            </span>
          )}
          {dirty && <span className="markdown-file-preview-dirty">未保存</span>}
          <button
            className="file-browser-pill"
            data-testid="save-markdown"
            disabled={editorReadOnly || !dirty || saving}
            onClick={onSave}
            type="button"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {windowNavigation && (
        <nav
          aria-label="Markdown 分段导航"
          className="markdown-file-preview-pagination"
        >
          <button
            disabled={
              windowNavigation.loading || !windowNavigation.previousAvailable
            }
            onClick={windowNavigation.onPrevious}
            type="button"
          >
            上一段
          </button>
          <span>{windowNavigation.label}</span>
          <button
            disabled={
              windowNavigation.loading || !windowNavigation.nextAvailable
            }
            onClick={windowNavigation.onNext}
            type="button"
          >
            下一段
          </button>
        </nav>
      )}

      <div
        className={`markdown-file-preview-workspace${
          showPreview && showNavigation && outlineOpen
            ? " markdown-file-preview-workspace--outline-open"
            : ""
        }`}
      >
        {showPreview && showNavigation && outlineOpen && (
          <nav aria-label="Markdown 目录" className="markdown-file-outline">
            <strong>{readOnly ? "当前段目录" : "目录"}</strong>
            {headings.length > 0 ? (
              <div className="markdown-file-outline-items">
                {headings.map((heading) => (
                  <button
                    aria-current={
                      activeHeadingId === heading.id ? "location" : undefined
                    }
                    key={heading.id}
                    onClick={() => jumpToHeading(heading.id)}
                    style={
                      {
                        "--markdown-outline-indent": `${Math.max(0, heading.level - 1) * 10}px`,
                      } as CSSProperties
                    }
                    title={heading.text}
                    type="button"
                  >
                    {heading.text}
                  </button>
                ))}
                {headings.length >= MARKDOWN_OUTLINE_ITEM_LIMIT && (
                  <span>
                    当前段目录最多显示 {MARKDOWN_OUTLINE_ITEM_LIMIT} 项
                  </span>
                )}
              </div>
            ) : (
              <span>当前内容没有标题</span>
            )}
          </nav>
        )}

        <div className="markdown-file-preview-content">
          {showEditor && (
            <textarea
              aria-label="Markdown 源码编辑器"
              className="markdown-file-preview-editor"
              data-testid="markdown-editor"
              onChange={(event) => onContentChange(event.target.value)}
              onScroll={handleEditorScroll}
              readOnly={editorReadOnly}
              ref={editorRef}
              spellCheck={false}
              value={content}
            />
          )}
          {showPreview && (
            <LazyMarkdownContent
              className="markdown-file-preview-rendered"
              content={deferredPreviewContent}
              contentRef={renderedRef}
              fallbackClassName="markdown-file-preview-loading"
              fallbackTestId="markdown-render-loading"
              fallbackText="正在生成预览..."
              onScroll={handlePreviewScroll}
              resourceContext={resourceContext}
            />
          )}
        </div>
      </div>
    </div>
  );
}
