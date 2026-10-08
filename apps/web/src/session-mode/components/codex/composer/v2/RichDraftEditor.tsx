import { lazy, Suspense, useId, useMemo } from "react";
import { splitDraftBlocks, replaceDraftBlock } from "./content";
const CodeBlockEditor = lazy(() => import("./CodeBlockEditor"));
export function RichDraftEditor({
  value,
  onChange,
  plain,
  onPlainChange,
  onSelection,
}: {
  value: string;
  onChange: (s: string) => void;
  plain: boolean;
  onPlainChange: (p: boolean) => void;
  onSelection?: (start: number, end: number) => void;
}) {
  const id = useId(),
    blocks = useMemo(() => splitDraftBlocks(value), [value]);
  return (
    <div className="session-rich-draft">
      <div className="session-rich-tools">
        <button
          type="button"
          aria-pressed={plain}
          onClick={() => onPlainChange(!plain)}
        >
          {plain ? "切换代码模式" : "纯文本模式"}
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(
              value +
                `${value && !value.endsWith("\n") ? "\n" : ""}\n\`\`\`typescript\n\n\`\`\`\n`,
            )
          }
        >
          插入代码块
        </button>
      </div>
      {plain || !blocks.length ? (
        <textarea
          aria-label="展开的消息草稿"
          onSelect={(e) =>
            onSelection?.(
              e.currentTarget.selectionStart,
              e.currentTarget.selectionEnd,
            )
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        blocks.map((block, i) =>
          block.kind === "text" ? (
            <textarea
              key={i}
              aria-label={`正文段落 ${i + 1}`}
              onSelect={(e) =>
                onSelection?.(
                  block.contentStart + e.currentTarget.selectionStart,
                  block.contentStart + e.currentTarget.selectionEnd,
                )
              }
              value={block.text}
              onChange={(e) =>
                onChange(replaceDraftBlock(value, block, e.target.value))
              }
              rows={Math.min(18, Math.max(3, block.text.split("\n").length))}
            />
          ) : (
            <section className="session-draft-code" key={i}>
              <header>
                <label>
                  语言
                  <select
                    aria-label={`代码块 ${i + 1} 的语言`}
                    value={block.language || "text"}
                    onChange={(e) => {
                      const raw = block.raw;
                      const firstEnd = raw.indexOf("\n");
                      const ending = raw[firstEnd - 1] === "\r" ? "\r\n" : "\n";
                      const opening = raw.match(/^ */)?.[0] ?? "";
                      onChange(
                        value.slice(0, block.start) +
                          opening +
                          block.fence +
                          (e.target.value === "text" ? "" : e.target.value) +
                          ending +
                          value.slice(block.start + firstEnd + 1),
                      );
                    }}
                  >
                    {[
                      ...new Set([
                        block.language || "text",
                        "text",
                        "typescript",
                        "javascript",
                        "python",
                        "json",
                        "bash",
                        "rust",
                        "go",
                        "cpp",
                        "html",
                        "css",
                        "sql",
                        "yaml",
                        "markdown",
                      ]),
                    ].map((lang) => (
                      <option key={lang} value={lang}>
                        {lang === "text" ? "纯文本" : lang}
                      </option>
                    ))}
                  </select>
                </label>
                <span>代码块</span>
              </header>
              <Suspense
                fallback={
                  <textarea
                    aria-label="代码内容"
                    value={block.text}
                    onChange={(e) =>
                      onChange(replaceDraftBlock(value, block, e.target.value))
                    }
                  />
                }
              >
                <CodeBlockEditor
                  id={`${id}-${i}`}
                  onSelection={(start, end) =>
                    onSelection?.(
                      block.contentStart + start,
                      block.contentStart + end,
                    )
                  }
                  value={block.text}
                  language={block.language ?? "text"}
                  onChange={(text) =>
                    onChange(
                      replaceDraftBlock(
                        value,
                        block,
                        text.endsWith("\n")
                          ? text
                          : text + (block.raw.includes("\r\n") ? "\r\n" : "\n"),
                      ),
                    )
                  }
                />
              </Suspense>
            </section>
          ),
        )
      )}
    </div>
  );
}
