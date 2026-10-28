import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { expect, test, vi } from "vitest";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";

// Ground truth: docs/designs/claude-render-alignment/composer-contract-20261027.md §2
// The two-layer construction is the mechanism, so these assertions pin the
// layering itself, not just the resulting text.

function setup(props: Partial<React.ComponentProps<typeof ComposerInput>> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const ref = createRef<ComposerInputHandle>();
  const result = render(
    <ComposerInput
      ref={ref}
      value=""
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder="Ask Claude to edit…"
      {...props}
    />,
  );
  const editor = screen.getByRole("textbox");
  return { ...result, editor, onChange, onSubmit, ref };
}

test("the editable surface is a plaintext-only contenteditable", () => {
  // Not a textarea: the official input needs a transparent text layer with a
  // visible caret, which a textarea cannot provide.
  const { editor } = setup();
  expect(editor.getAttribute("contenteditable")).toBe("plaintext-only");
  expect(editor.tagName).toBe("DIV");
  expect(editor.getAttribute("aria-multiline")).toBe("true");
  expect(editor.getAttribute("aria-label")).toBe("Message input");
  expect(editor.getAttribute("aria-autocomplete")).toBe("list");
});

test("the placeholder rides on a data attribute, not the DOM", () => {
  // contenteditable has no placeholder attribute; CSS renders this one.
  const { editor } = setup({ placeholder: "Queue another message…" });
  expect(editor.getAttribute("data-placeholder")).toBe(
    "Queue another message…",
  );
});

test("a hidden mirror layer accompanies the editor", () => {
  const { container } = setup({ value: "hello" });
  const mirror = container.querySelector(".claude-mention-mirror")!;
  expect(mirror).not.toBeNull();
  // The mirror must never be announced: the real field already is.
  expect(mirror.getAttribute("aria-hidden")).toBe("true");
  expect(mirror.textContent).toBe("hello");
});

test("inserted mentions are painted as chips in the mirror only", () => {
  const { container, editor } = setup({
    value: "edit @a.ts now",
    insertedMentions: new Set(["@a.ts"]),
  });
  const chips = container.querySelectorAll(".claude-mention-chip");
  expect(chips).toHaveLength(1);
  expect(chips[0].textContent).toBe("@a.ts");

  // The real input stays plain text — the official insert is a text token,
  // so a chip element there would break caret math and copy/paste.
  expect(editor.querySelector(".claude-mention-chip")).toBeNull();
  expect(editor.textContent).toBe("edit @a.ts now");
});

test("text that was never inserted is not chipped", () => {
  const { container } = setup({
    value: "@not-a-real-mention",
    insertedMentions: new Set(),
  });
  expect(container.querySelector(".claude-mention-chip")).toBeNull();
});

test("typing reports the plain text content", () => {
  const { editor, onChange } = setup();
  editor.textContent = "typed";
  fireEvent.input(editor);
  expect(onChange).toHaveBeenCalledWith("typed");
});

test("Enter submits and Shift+Enter does not", () => {
  const { editor, onSubmit } = setup({ value: "hi" });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("useCtrlEnterToSend requires the modifier", () => {
  const { editor, onSubmit } = setup({
    value: "hi",
    useCtrlEnterToSend: true,
  });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("an IME composition never submits", () => {
  // A CJK candidate is confirmed with Enter; submitting there loses the word.
  const { editor, onSubmit } = setup({ value: "汉字" });

  fireEvent.compositionStart(editor);
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();

  // Some IMEs only report the legacy keyCode.
  fireEvent.compositionEnd(editor);
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 229 });
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a caller's keydown handler can preempt submission", () => {
  // The suggestion menus consume Enter to accept a completion.
  const onSubmit = vi.fn();
  const onKeyDown = vi.fn((event: React.KeyboardEvent) =>
    event.preventDefault(),
  );
  const { editor } = setup({ value: "hi", onSubmit, onKeyDown });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(onKeyDown).toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("external value changes reach the DOM", () => {
  // Draft restore and slash-command insertion both set the value from outside.
  const { editor, rerender, onChange, onSubmit } = setup({ value: "" });
  rerender(
    <ComposerInput
      value="restored draft"
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder="p"
    />,
  );
  expect(editor.textContent).toBe("restored draft");
});

test("the handle exposes focus and the caret offset", () => {
  const { ref, editor } = setup({ value: "abc" });
  ref.current!.focus();
  expect(document.activeElement).toBe(editor);
  expect(ref.current!.element()).toBe(editor);
  // jsdom has no real caret, so this is the collapsed-at-start case.
  expect(typeof ref.current!.caret()).toBe("number");
});

test("a disabled composer is not editable", () => {
  const { editor } = setup({ disabled: true });
  expect(editor.getAttribute("contenteditable")).toBe("false");
});

test("the combobox wiring points at the open menu", () => {
  const { editor } = setup({
    ariaControls: "at-mention-list",
    ariaActiveDescendant: "option-2",
  });
  expect(editor.getAttribute("aria-controls")).toBe("at-mention-list");
  expect(editor.getAttribute("aria-activedescendant")).toBe("option-2");
});
