import { useLayoutEffect, useRef } from "react";
import { submitIntent } from "@session/components/codex/composer/editor/submitIntent";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
/** Plain authored Markdown in the native multiline editor surface. The edit owner lives outside this DOM. */
export function InlineEditInput({
  value,
  onChange,
  onSubmit,
  onCollapse,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCollapse: () => void;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || composing.current) return;
    const current = root.innerText ?? root.textContent ?? "";
    if (current !== value) root.textContent = value;
  }, [value]);
  const read = () => {
    const root = ref.current;
    if (root) onChange(root.innerText ?? root.textContent ?? "");
  };
  return (
    <div className="codex-native-inline-edit-body">
      <div
        ref={ref}
        contentEditable={disabled ? false : "plaintext-only"}
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        spellCheck
        tabIndex={disabled ? -1 : 0}
        onInput={read}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          read();
        }}
        onKeyDown={(event) => {
          if (
            disabled ||
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCollapse();
          }
          if (event.key !== "Enter") return;
          if (
            window.matchMedia?.("(pointer: coarse)").matches &&
            !event.ctrlKey &&
            !event.metaKey
          )
            return;
          if (
            submitIntent(
              event.nativeEvent,
              value,
              useFollowupSettingsStore.getState().enterBehavior,
            )
          ) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
