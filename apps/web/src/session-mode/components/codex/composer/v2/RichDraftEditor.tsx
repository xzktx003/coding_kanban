import { lazy, Suspense, useEffect, useId, useMemo, useRef } from "react";
import { splitDraftBlocks, replaceDraftBlock } from "./content";
import { formatDraftRange } from "../editor/formatSelection";
import { CodeLanguagePicker } from "./CodeLanguagePicker";
import { canonicalCodeLanguage } from "./codeLanguages";
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
  const selection = useRef({ start: 0, end: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;
  const remember = (start: number, end: number) => {
    selection.current = { start, end };
    onSelection?.(start, end);
  };
  const markRange = (
    event: { currentTarget: HTMLTextAreaElement },
    base: number,
  ) => {
    const start = base + event.currentTarget.selectionStart;
    const end = base + event.currentTarget.selectionEnd;
    event.currentTarget.dataset.draftSelection = `${start}:${end}`;
    remember(start, end);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const listKind =
        (event.altKey && !event.shiftKey && event.key === "4") ||
        (event.shiftKey && !event.altKey && event.key === "9")
          ? "ol"
          : (event.altKey && !event.shiftKey && event.key === "5") ||
              (event.shiftKey && !event.altKey && event.key === "8")
            ? "ul"
            : event.altKey && !event.shiftKey && event.key === "6"
              ? "check"
              : null;
      if (!listKind || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target;
      if (
        !(target instanceof HTMLTextAreaElement) ||
        !target.closest(".session-rich-draft")
      )
        return;
      const base = Number(target.dataset.draftStart ?? 0);
      const next = formatDraftRange(
        valueRef.current,
        base + target.selectionStart,
        base + target.selectionEnd,
        listKind,
      );
      if (!next) return;
      event.preventDefault();
      onChange(next.value);
      remember(next.start, next.end);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange, onSelection]);
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
                `\`\`\`\n\n\`\`\`\n${value && !value.startsWith("\n") ? "\n" : ""}${value}`,
            )
          }
        >
          插入代码块
        </button>
      </div>
      {plain || !blocks.length ? (
        <textarea
          data-draft-start={0}
          aria-label="展开的消息草稿"
          onSelect={(e) => markRange(e, 0)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        blocks.map((block, i) =>
          block.kind === "text" ? (
            <textarea
              key={i}
              data-draft-start={block.contentStart}
              aria-label={`正文段落 ${i + 1}`}
              onSelect={(e) => markRange(e, block.contentStart)}
              value={block.text}
              onChange={(e) =>
                onChange(replaceDraftBlock(value, block, e.target.value))
              }
              rows={Math.min(18, Math.max(3, block.text.split("\n").length))}
            />
          ) : (
            <section className="session-draft-code" key={i}>
              <header>
                <CodeLanguagePicker
                  index={i + 1}
                  language={block.language ?? ""}
                  code={block.text}
                  onChange={(language) => {
                    const raw = block.raw;
                    const firstEnd = raw.indexOf("\n");
                    const ending = raw[firstEnd - 1] === "\r" ? "\r\n" : "\n";
                    const opening = raw.match(/^ */)?.[0] ?? "";
                    const token =
                      language === "" ? "" : canonicalCodeLanguage(language);
                    onChange(
                      value.slice(0, block.start) +
                        opening +
                        block.fence +
                        token +
                        ending +
                        value.slice(block.start + firstEnd + 1),
                    );
                  }}
                />
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
