import { submitIntent } from "./submitIntent";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type RangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { type MentionItem, useMentionItems } from "../mentions";
import { MentionChipDeletePlugin } from "./MentionChipDeletePlugin";
import { MentionChipNode } from "./MentionChipNode";
import { MentionTypeaheadPlugin } from "./MentionTypeaheadPlugin";
import { $setEditorFromString } from "./useExternalValueSync";
import { shouldAutoFocusComposer } from "../composerFocus";

export interface ComposerEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
}

interface ComposerEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (intent?: "default" | "opposite") => void;
  placeholder: string;
}

/** Enter submits, Shift+Enter inserts a newline, IME composition never submits. */
function SubmitPlugin({
  onSubmit,
}: {
  onSubmit: (intent?: "default" | "opposite") => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || editor.isComposing()) return false;
          // Mobile soft keyboards use Return for composing multi-line messages.
          // Explicit modifiers on external keyboards retain the desktop shortcuts.
          if (
            window.matchMedia?.("(pointer: coarse)").matches &&
            !event.ctrlKey &&
            !event.metaKey
          )
            return false;
          const intent = submitIntent(
            event,
            $getRoot().getTextContent(),
            useFollowupSettingsStore.getState().enterBehavior,
          );
          if (!intent) return false;
          event.preventDefault();
          onSubmitRef.current(intent);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  return null;
}

/**
 * Keeps the editor in sync with the plain string owned outside (dictation, the
 * plus menu, the `@` / `/` popovers, draft restore). Known mention texts are
 * re-tokenized into chips. Comparing against the editor's own text content
 * makes this a no-op for edits that originated in the editor.
 */
function ExternalValuePlugin({
  value,
  onChange,
  items,
  handleRef,
}: {
  value: string;
  onChange: (value: string) => void;
  items: MentionItem[];
  handleRef: React.RefObject<ComposerEditorHandle | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const selectionRef = useRef<RangeSelection | null>(null);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection))
            selectionRef.current = selection.clone();
        }),
      ),
    [editor],
  );
  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => editor.focus(),
      insertText: (text) =>
        editor.update(() => {
          try {
            if (selectionRef.current)
              $setSelection(selectionRef.current.clone());
          } catch {
            $getRoot().selectEnd();
          }
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if ($isRangeSelection(selection)) selection.insertText(text);
        }),
    }),
    [editor],
  );

  // Focus on mount, matching the previous textarea behaviour.
  useEffect(() => {
    if (!shouldAutoFocusComposer()) return;
    editor.focus();
  }, [editor]);

  useEffect(() => {
    const root = editor.getRootElement();
    // Restoring another draft must not move the DOM selection into this editor:
    // WebKit/Chromium can focus contenteditable through selection alone.
    const passive = !root?.contains(document.activeElement);
    editor.update(
      () => {
        if ($getRoot().getTextContent() === value) {
          return;
        }
        $setEditorFromString(value, items);
        if (passive) $setSelection(null);
      },
      { tag: passive ? SKIP_DOM_SELECTION_TAG : undefined },
    );
  }, [value, items, editor]);

  const handleChange = useCallback(
    (
      editorState: Parameters<
        Parameters<typeof OnChangePlugin>[0]["onChange"]
      >[0],
    ) => {
      const text = editorState.read(() => $getRoot().getTextContent());
      if (text !== value) {
        onChange(text);
      }
    },
    [onChange, value],
  );

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}

export const ComposerEditor = forwardRef<
  ComposerEditorHandle,
  ComposerEditorProps
>(function ComposerEditor({ value, onChange, onSubmit, placeholder }, ref) {
  const handleRef = useRef<ComposerEditorHandle | null>(null);
  const { items } = useMentionItems();

  useImperativeHandle(
    ref,
    () => ({
      focus: () => handleRef.current?.focus(),
      insertText: (text) => handleRef.current?.insertText(text),
    }),
    [],
  );

  return (
    <div className="relative">
      <LexicalComposer
        initialConfig={{
          namespace: "codex-composer",
          nodes: [MentionChipNode],
          theme: {},
          onError: (error: Error) => console.error(error),
        }}
      >
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="w-full min-h-[44px] bg-transparent text-base md:text-sm outline-none whitespace-pre-wrap break-words"
              aria-placeholder={placeholder}
              placeholder={
                <div className="pointer-events-none absolute top-0 left-0 text-base text-muted-foreground md:text-sm">
                  {placeholder}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <SubmitPlugin onSubmit={onSubmit} />
        <MentionChipDeletePlugin />
        <MentionTypeaheadPlugin items={items} />
        <ExternalValuePlugin
          value={value}
          onChange={onChange}
          items={items}
          handleRef={handleRef}
        />
      </LexicalComposer>
    </div>
  );
});
