/**
 * The composer's editable surface, aligned with the official Claude Code
 * VS Code extension 2.1.311 (`entry/chunk_Zq.js:1554`).
 *
 * The official input is a two-layer construction, and the layering is the
 * mechanism rather than a detail: the real `contentEditable` paints its text
 * transparent and keeps only the caret visible, while an `aria-hidden` mirror
 * sitting exactly on top renders the highlighted version (mention chips).
 * Both layers share identical padding and scroll together, so the caret lands
 * where the painted text appears.
 *
 * Reference: docs/designs/claude-render-alignment/composer-contract-20261027.md §2
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { enterAction, mentionSpans } from "./composer";

export interface ComposerInputHandle {
  focus: () => void;
  /** The live caret offset, used to resolve `@`/`/` triggers. */
  caret: () => number;
  element: () => HTMLDivElement | null;
  /**
   * Satisfies `ComposerEditorTarget` so the slash/skill/mention popovers can
   * place the caret after inserting a completion.
   */
  setSelectionRange: (start: number, end: number) => void;
}

export interface ComposerInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** `claudeCode.useCtrlEnterToSend`. */
  useCtrlEnterToSend?: boolean;
  /** Mention tokens already inserted, painted as chips by the mirror. */
  insertedMentions?: ReadonlySet<string>;
  disabled?: boolean;
  ariaControls?: string;
  ariaActiveDescendant?: string;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

/** Caret offset in plain-text terms, across the contenteditable's nodes. */
function caretOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return 0;
  const measured = range.cloneRange();
  measured.selectNodeContents(root);
  measured.setEnd(range.endContainer, range.endOffset);
  return measured.toString().length;
}

function setCaret(root: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.length;
    node = walker.nextNode() as Text | null;
  }
  // Past the end: collapse to the very end of the field.
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const ComposerInput = forwardRef<
  ComposerInputHandle,
  ComposerInputProps
>(function ComposerInput(
  {
    value,
    onChange,
    onSubmit,
    placeholder,
    useCtrlEnterToSend = false,
    insertedMentions,
    disabled = false,
    ariaControls,
    ariaActiveDescendant,
    onKeyDown,
    onPaste,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  // An IME may report composition through either signal; both are honored.
  const composing = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    caret: () => (editorRef.current ? caretOffset(editorRef.current) : 0),
    element: () => editorRef.current,
    setSelectionRange: (start: number) => {
      const editor = editorRef.current;
      if (editor) setCaret(editor, start);
    },
  }));

  // Keep the DOM in sync when the value changes from outside (draft restore,
  // a completion, a slash command), without disturbing the caret on our own
  // edits.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.textContent === value) return;
    const hadFocus = document.activeElement === editor;
    const offset = hadFocus ? caretOffset(editor) : 0;
    editor.textContent = value;
    if (hadFocus) setCaret(editor, Math.min(offset, value.length));
  }, [value]);

  const syncScroll = useCallback(() => {
    const editor = editorRef.current;
    const mirror = mirrorRef.current;
    if (!editor || !mirror) return;
    mirror.scrollTop = editor.scrollTop;
    mirror.scrollLeft = editor.scrollLeft;
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      const native = event.nativeEvent as KeyboardEvent & {
        isComposing?: boolean;
      };
      const action = enterAction(
        {
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          isComposing: composing.current || native.isComposing,
          keyCode: native.keyCode,
        },
        useCtrlEnterToSend,
      );

      if (action === "submit") {
        event.preventDefault();
        onSubmit();
        return;
      }
      if (action === "newline") {
        // plaintext-only contenteditable needs the break inserted explicitly.
        // Done through the value rather than execCommand, which is deprecated
        // and absent in some environments.
        event.preventDefault();
        const editor = editorRef.current;
        if (!editor) return;
        const at = caretOffset(editor);
        const next = `${value.slice(0, at)}\n${value.slice(at)}`;
        editor.textContent = next;
        setCaret(editor, at + 1);
        onChange(next);
      }
    },
    [onChange, onKeyDown, onSubmit, useCtrlEnterToSend, value],
  );

  // The mirror paints the same text, wrapping inserted mentions in chips.
  const mirror = (() => {
    const spans = insertedMentions?.size
      ? mentionSpans(value, insertedMentions)
      : [];
    if (spans.length === 0) return value;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    spans.forEach((span, index) => {
      if (span.start < cursor) return;
      if (span.start > cursor) parts.push(value.slice(cursor, span.start));
      parts.push(
        <span className="claude-mention-chip" key={`${span.start}-${index}`}>
          {span.token}
        </span>,
      );
      cursor = span.end;
    });
    if (cursor < value.length) parts.push(value.slice(cursor));
    return parts;
  })();

  return (
    <div className="claude-message-input-container">
      <div
        ref={editorRef}
        className="claude-message-input"
        contentEditable={disabled ? false : "plaintext-only"}
        suppressContentEditableWarning
        role="textbox"
        aria-label="Message input"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-controls={ariaControls}
        aria-activedescendant={ariaActiveDescendant}
        // contenteditable has no placeholder attribute; CSS renders this.
        data-placeholder={placeholder}
        onInput={(event) => {
          onChange(event.currentTarget.textContent ?? "");
          syncScroll();
        }}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onPaste={onPaste}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          // The keydown for the confirming Enter can arrive after
          // compositionend, so clear on the next tick rather than inline.
          setTimeout(() => {
            composing.current = false;
          }, 50);
        }}
      />
      <div ref={mirrorRef} className="claude-mention-mirror" aria-hidden="true">
        {mirror}
      </div>
    </div>
  );
});
