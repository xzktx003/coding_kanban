import { lazy, Suspense, useEffect, useId, useMemo, useRef } from "react";
import { splitDraftBlocks, replaceDraftBlock } from "./content";
import { formatDraftRange } from "../editor/formatSelection";
import { CodeLanguagePicker } from "./CodeLanguagePicker";
import { canonicalCodeLanguage } from "./codeLanguages";
import { matchesSessionShortcut } from "@session/services/sessionKeyboardShortcuts";
const CodeBlockEditor = lazy(() => import("./CodeBlockEditor"));
// Textareas normalize CRLF to LF; draft offsets always address the original text.
function draftOffset(raw: string, offset: number) {
  let index = 0;
  for (let position = 0; position < offset && index < raw.length; position++) {
    index += raw[index] === "\r" && raw[index + 1] === "\n" ? 2 : 1;
  }
  return index;
}
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
  const selection = useRef<{ start: number; end: number } | null>(null);
  const composing = useRef(false);
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
    const raw = valueRef.current.slice(base);
    const start = base + draftOffset(raw, event.currentTarget.selectionStart);
    const end = base + draftOffset(raw, event.currentTarget.selectionEnd);
    event.currentTarget.dataset.draftSelection = `${start}:${end}`;
    remember(start, end);
  };
  const insertCodeBlock = () => {
    if (composing.current) return;
    const current = valueRef.current;
    let start = Math.min(
      current.length,
      selection.current?.start ?? current.length,
    );
    let end = Math.max(
      start,
      Math.min(current.length, selection.current?.end ?? start),
    );
    // A code editor's selection already belongs to a fenced block. Add its
    // sibling after that block rather than inserting nested Markdown into code.
    const code =
      !plain &&
      blocks.find(
        (block) =>
          block.kind === "code" &&
          start >= block.contentStart &&
          end <= block.contentEnd,
      );
    if (code) start = end = code.end;
    const before = current.slice(0, start),
      selected = current.slice(start, end);
    const after = current.slice(end),
      newline = current.includes("\r\n") ? "\r\n" : "\n";
    let fenceLength = 3;
    for (const match of selected.matchAll(/`+/g)) {
      fenceLength = Math.max(fenceLength, match[0].length + 1);
    }
    const fence = "`".repeat(fenceLength);
    const prefix = before && !before.endsWith("\n") ? newline : "";
    const body = selected.endsWith("\n") ? selected : selected + newline;
    const insertion =
      prefix +
      fence +
      newline +
      body +
      fence +
      (after.startsWith("\n") || after.startsWith("\r\n") ? "" : newline);
    onChange(before + insertion + after);
    remember(
      start + prefix.length + fence.length + newline.length,
      start + prefix.length + fence.length + newline.length + selected.length,
    );
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (composing.current || event.isComposing || event.keyCode === 229)
        return;
      const listKind =
        matchesSessionShortcut(event, "ordered-list")
          ? "ol"
          : matchesSessionShortcut(event, "unordered-list")
            ? "ul"
            : matchesSessionShortcut(event, "checklist")
              ? "check"
              : null;
      if (!listKind) return;
      const target = event.target;
      if (
        !(target instanceof HTMLTextAreaElement) ||
        !target.closest(".session-rich-draft")
      )
        return;
      const base = Number(target.dataset.draftStart ?? 0);
      const next = formatDraftRange(
        valueRef.current,
        base + draftOffset(valueRef.current.slice(base), target.selectionStart),
        base + draftOffset(valueRef.current.slice(base), target.selectionEnd),
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
    <div
      className="session-rich-draft"
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
    >
      <div
        className="session-rich-tools"
        onMouseDown={(event) => {
          // Keep the input's selection/composition until the explicit action.
          if ((event.target as HTMLElement).closest("button"))
            event.preventDefault();
        }}
      >
        <button
          type="button"
          aria-pressed={plain}
          onClick={() => {
            if (!composing.current) onPlainChange(!plain);
          }}
        >
          {plain ? "切换代码模式" : "纯文本模式"}
        </button>
        <button type="button" onClick={insertCodeBlock}>
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
            <section
              className="session-draft-code"
              key={i}
              data-draft-code-start={block.contentStart}
            >
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
                    data-draft-start={block.contentStart}
                    aria-label="代码内容"
                    onSelect={(e) => markRange(e, block.contentStart)}
                    value={block.text}
                    onChange={(e) =>
                      onChange(replaceDraftBlock(value, block, e.target.value))
                    }
                  />
                }
              >
                <CodeBlockEditor
                  id={`${id}-${i}`}
                  onSelection={(start, end) => {
                    // Ace also emits its initial selection while mounting.
                    // Only a focused editor can replace the user's insert target.
                    if (
                      document.activeElement
                        ?.closest("[data-draft-code-start]")
                        ?.getAttribute("data-draft-code-start") !==
                      String(block.contentStart)
                    )
                      return;
                    remember(
                      block.contentStart + start,
                      block.contentStart + end,
                    );
                  }}
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
