import { expect, test } from "vitest";
import {
  applyCompletion,
  availableModes,
  enterAction,
  mentionSpans,
  mentionToken,
  mentionTrigger,
  modeLabel,
  modeRingClass,
  nextMode,
  PERMISSION_MODES,
  placeholderText,
  slashTrigger,
} from "./composer";

// Ground truth: docs/designs/claude-render-alignment/composer-contract-20261027.md

test("the permission modes match the official values and copy", () => {
  expect(PERMISSION_MODES.map((mode) => mode.value)).toEqual([
    "dontAsk",
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "bypassPermissions",
  ]);
  // `manual` is a label, not a mode value — the manifest enum disagrees with
  // the webview and the webview is what users see.
  expect(PERMISSION_MODES.map((mode) => mode.value)).not.toContain("manual");
  expect(modeLabel("default")).toBe("Manual");
  expect(modeLabel("acceptEdits")).toBe("Edit automatically");
  expect(modeLabel("bypassPermissions")).toBe("Bypass permissions");

  const auto = PERMISSION_MODES.find((mode) => mode.value === "auto")!;
  expect(auto.description).toBe(
    "Claude will approve actions that pass a safety check and pause for anything risky",
  );
});

test("the offered modes are the base three until the host opts in", () => {
  expect(availableModes({})).toEqual(["default", "acceptEdits", "plan"]);
  expect(availableModes({ autoAvailable: true })).toEqual([
    "default",
    "acceptEdits",
    "plan",
    "auto",
  ]);
  expect(
    availableModes({ autoAvailable: true, bypassAvailable: true }),
  ).toEqual(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
});

test("dontAsk is only offered when already selected", () => {
  // It cannot be entered from the picker, only exited.
  expect(availableModes({})).not.toContain("dontAsk");
  expect(availableModes({ current: "dontAsk" })[0]).toBe("dontAsk");
});

test("Shift+Tab cycles the offered list and wraps", () => {
  const modes = availableModes({});
  expect(nextMode("default", modes)).toBe("acceptEdits");
  expect(nextMode("acceptEdits", modes)).toBe("plan");
  expect(nextMode("plan", modes)).toBe("default");
  // A mode that is not offered falls back to the first entry.
  expect(nextMode("bypassPermissions", modes)).toBe("default");
  expect(nextMode("default", [])).toBe("default");
});

test("the focus ring marks the risky modes distinctly", () => {
  expect(modeRingClass("acceptEdits")).toBe("claude-composer-accept");
  expect(modeRingClass("plan")).toBe("claude-composer-plan");
  expect(modeRingClass("bypassPermissions")).toBe("claude-composer-danger");
  expect(modeRingClass("auto")).toBe("claude-composer-danger");
  expect(modeRingClass("default")).toBe("claude-composer-default");
  expect(modeRingClass(undefined)).toBe("claude-composer-default");
});

test("Enter submits by default and Shift+Enter inserts a newline", () => {
  expect(enterAction({ key: "Enter" })).toBe("submit");
  expect(enterAction({ key: "Enter", shiftKey: true })).toBe("newline");
  expect(enterAction({ key: "a" })).toBe("ignore");
});

test("useCtrlEnterToSend inverts Enter", () => {
  expect(enterAction({ key: "Enter" }, true)).toBe("newline");
  expect(enterAction({ key: "Enter", ctrlKey: true }, true)).toBe("submit");
  expect(enterAction({ key: "Enter", metaKey: true }, true)).toBe("submit");
});

test("an IME composition never submits", () => {
  // CJK input confirms a candidate with Enter. Both signals must be honored:
  // Safari/Chrome report isComposing, some IMEs only report keyCode 229.
  expect(enterAction({ key: "Enter", isComposing: true })).toBe("ignore");
  expect(enterAction({ key: "Enter", keyCode: 229 })).toBe("ignore");
  expect(
    enterAction({ key: "Enter", isComposing: true, ctrlKey: true }, true),
  ).toBe("ignore");
  expect(enterAction({ key: "Enter", keyCode: 229 }, true)).toBe("ignore");
});

test("the placeholder follows the official priority order", () => {
  // A live suggestion outranks everything, including busy.
  expect(
    placeholderText({ suggestion: "try this", busy: true }),
  ).toBe("try this");
  expect(placeholderText({ busy: true })).toBe("Queue another message…");
  expect(placeholderText({ hasSelection: true, isMac: true })).toBe(
    "⌘ Esc to attach selected text",
  );
  expect(placeholderText({ hasSelection: true })).toBe(
    "ctrl esc to attach selected text",
  );
  // On mobile there is no keyboard shortcut to advertise.
  expect(placeholderText({ hasSelection: true, isMobile: true })).toBe(
    "ctrl esc to focus or unfocus Claude",
  );
  expect(placeholderText({ focused: false })).toBe("Ask Claude to edit…");
  expect(placeholderText({ isMac: true })).toBe(
    "⌘ Esc to focus or unfocus Claude",
  );
});

test("the @ trigger fires at a word start, not mid-word", () => {
  expect(mentionTrigger("@src", 4)).toEqual({ query: "src", start: 0 });
  expect(mentionTrigger("see @src/app", 12)).toEqual({
    query: "src/app",
    start: 4,
  });
  // An email address must not open the file menu.
  expect(mentionTrigger("mail me@example.com", 19)).toBeUndefined();
  // The caret has to be inside the token.
  expect(mentionTrigger("@src and more", 13)).toBeUndefined();
  expect(mentionTrigger("", 0)).toBeUndefined();
});

test("the bare @ opens the menu with an empty query", () => {
  expect(mentionTrigger("@", 1)).toEqual({ query: "", start: 0 });
});

test("the slash trigger only fires on a leading token", () => {
  expect(slashTrigger("/rev", 4)).toEqual({ query: "rev", start: 0 });
  expect(slashTrigger("say /rev", 8)).toEqual({ query: "rev", start: 4 });
  // A path must not be read as a command.
  expect(slashTrigger("src/app/main.ts", 15)).toBeUndefined();
});

test("a mention token quotes paths containing whitespace", () => {
  expect(mentionToken("src/app.ts")).toBe("@src/app.ts");
  expect(mentionToken("my docs/a.md")).toBe('@"my docs/a.md"');
});

test("a completion replaces exactly the trigger token", () => {
  const text = "look at @src";
  const trigger = mentionTrigger(text, text.length)!;
  const applied = applyCompletion(text, trigger, "@src/app.ts");
  expect(applied.text).toBe("look at @src/app.ts");
  expect(applied.caret).toBe(applied.text.length);
});

test("a completion keeps text that follows the caret", () => {
  const text = "see @src end";
  const trigger = mentionTrigger("see @src", 8)!;
  const applied = applyCompletion(text, trigger, "@src/app.ts");
  expect(applied.text).toBe("see @src/app.ts end");
});

test("mention spans locate every inserted token for the mirror layer", () => {
  // The real input stays plain text; the chips are painted from these spans.
  const inserted = new Set(["@a.ts", "@b.ts"]);
  const spans = mentionSpans("edit @a.ts and @b.ts and @a.ts", inserted);
  expect(spans.map((span) => span.token)).toEqual([
    "@a.ts",
    "@b.ts",
    "@a.ts",
  ]);
  expect(spans[0].start).toBe(5);
  expect(spans[0].end).toBe(10);
  // Spans come back in document order so the mirror can walk them once.
  expect(spans.map((s) => s.start)).toEqual(
    [...spans.map((s) => s.start)].sort((a, b) => a - b),
  );
});

test("text that merely looks like a mention is not a span", () => {
  expect(mentionSpans("@never-inserted", new Set())).toEqual([]);
});
