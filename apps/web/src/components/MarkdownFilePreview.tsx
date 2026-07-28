import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

if (typeof document !== "undefined") {
  void import("katex/dist/katex.min.css");
}

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

interface MarkdownFence {
  marker: "`" | "~";
  length: number;
}

function normalizeInlineLatexDelimiters(line: string): string {
  let output = "";
  let codeTickLength = 0;
  let index = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      let tickEnd = index + 1;
      while (line[tickEnd] === "`") {
        tickEnd += 1;
      }
      const tickLength = tickEnd - index;
      if (codeTickLength === 0) {
        codeTickLength = tickLength;
      } else if (codeTickLength === tickLength) {
        codeTickLength = 0;
      }
      output += line.slice(index, tickEnd);
      index = tickEnd;
      continue;
    }

    const isUnescapedDelimiter = index === 0 || line[index - 1] !== "\\";
    if (
      codeTickLength === 0 &&
      isUnescapedDelimiter &&
      (line.startsWith("\\(", index) || line.startsWith("\\)", index))
    ) {
      output += "$";
      index += 2;
      continue;
    }

    output += line[index];
    index += 1;
  }

  return output;
}

export function normalizeLatexMathDelimiters(content: string): string {
  let fence: MarkdownFence | null = null;

  return content
    .split(/(\r?\n)/)
    .map((line) => {
      if (line === "\n" || line === "\r\n") {
        return line;
      }

      const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as MarkdownFence["marker"];
        const markerLength = fenceMatch[1].length;
        if (fence) {
          if (
            marker === fence.marker &&
            markerLength >= fence.length &&
            fenceMatch[2].trim() === ""
          ) {
            fence = null;
          }
        } else {
          fence = { marker, length: markerLength };
        }
        return line;
      }

      if (fence || /^(?: {4}|\t)/.test(line)) {
        return line;
      }

      const blockStart = /^(\s*)\\\[(\s*)$/.exec(line);
      if (blockStart) {
        return `${blockStart[1]}$$${blockStart[2]}`;
      }

      const blockEnd = /^(\s*)\\\](\s*)$/.exec(line);
      if (blockEnd) {
        return `${blockEnd[1]}$$${blockEnd[2]}`;
      }

      return normalizeInlineLatexDelimiters(line);
    })
    .join("");
}

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
          <article
            className="markdown-file-preview-rendered"
            data-testid="markdown-rendered"
          >
            <ReactMarkdown
              components={{
                a: ({ children, ...props }) => (
                  <a {...props} rel="noopener noreferrer" target="_blank">
                    {children}
                  </a>
                ),
              }}
              rehypePlugins={[
                [rehypeKatex, { strict: "ignore", throwOnError: false }],
              ]}
              remarkPlugins={[remarkGfm, remarkMath]}
            >
              {normalizeLatexMathDelimiters(content)}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
