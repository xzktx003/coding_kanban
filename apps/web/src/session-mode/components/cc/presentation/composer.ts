/**
 * Composer behavior, aligned with the official Claude Code VS Code extension
 * 2.1.311 (`entry/chunk_Zq.js`, `entry/chunk_by0.js`, `entry/chunk_i7.js`).
 *
 * Reference: docs/designs/claude-render-alignment/composer-contract-20261027.md
 */

/** The permission modes the official picker offers, with its exact copy. */
export interface PermissionModeOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Note `manual` is not a mode value: `Manual` is the label for `default`.
 * The extension manifest's enum disagrees with the webview; the webview wins.
 */
export const PERMISSION_MODES: readonly PermissionModeOption[] = [
  {
    value: "dontAsk",
    label: "Don't ask",
    description:
      "Claude will deny actions that need approval instead of asking",
  },
  {
    value: "default",
    label: "Manual",
    description: "Claude will ask for approval before making each edit",
  },
  {
    value: "acceptEdits",
    label: "Edit automatically",
    description: "Claude will edit your selected text or the whole file",
  },
  {
    value: "plan",
    label: "Plan",
    description:
      "Claude will explore the code and present a plan before editing",
  },
  {
    value: "auto",
    label: "Auto",
    description:
      "Claude will approve actions that pass a safety check and pause for anything risky",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    description:
      "Claude will not ask for approval before running potentially dangerous commands",
  },
];

export interface ModeAvailability {
  current?: string;
  autoAvailable?: boolean;
  bypassAvailable?: boolean;
}

/**
 * `g0()` — the modes actually offered. The base three are always present;
 * `dontAsk` only appears when already selected, so it cannot be entered from
 * the picker, and the two risky modes require host opt-in.
 */
export function availableModes({
  current,
  autoAvailable = false,
  bypassAvailable = false,
}: ModeAvailability): string[] {
  const modes: string[] = [];
  if (current === "dontAsk") modes.push("dontAsk");
  modes.push("default", "acceptEdits", "plan");
  if (autoAvailable) modes.push("auto");
  if (bypassAvailable) modes.push("bypassPermissions");
  return modes;
}

/** Shift+Tab cycles the offered list in order, wrapping at the end. */
export function nextMode(current: string, available: string[]): string {
  if (available.length === 0) return current;
  const index = available.indexOf(current);
  if (index === -1) return available[0];
  return available[(index + 1) % available.length];
}

export function modeLabel(value: string): string {
  return PERMISSION_MODES.find((mode) => mode.value === value)?.label ?? value;
}

/** The focus-ring class the official composer keys off `data-permission-mode`. */
export function modeRingClass(value: string | undefined): string {
  switch (value) {
    case "acceptEdits":
      return "claude-composer-accept";
    case "plan":
      return "claude-composer-plan";
    case "bypassPermissions":
    case "auto":
      return "claude-composer-danger";
    default:
      return "claude-composer-default";
  }
}

// ------------------------------------------------------------------ sending

export interface SubmitKeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** IME composition state; Enter confirms a candidate, it does not submit. */
  isComposing?: boolean;
  keyCode?: number;
}

export type SubmitAction = "submit" | "newline" | "ignore";

/**
 * `onEnterWithoutRow` — Enter semantics, including the
 * `claudeCode.useCtrlEnterToSend` setting.
 *
 * The IME guard checks both `isComposing` and `keyCode === 229`, matching the
 * project's existing `shouldSubmitOnEnter`: CJK input methods confirm a
 * candidate with Enter, and missing either signal submits mid-word.
 */
export function enterAction(
  event: SubmitKeyInput,
  useCtrlEnterToSend = false,
): SubmitAction {
  if (event.key !== "Enter") return "ignore";
  if (event.isComposing || event.keyCode === 229) return "ignore";

  const withModifier = !!(event.ctrlKey || event.metaKey);

  if (useCtrlEnterToSend)
    return withModifier ? "submit" : "newline";

  // Default: Enter submits, Shift+Enter inserts a newline.
  if (event.shiftKey) return "newline";
  return "submit";
}

// --------------------------------------------------------------- placeholder

export interface PlaceholderInput {
  busy?: boolean;
  suggestion?: string;
  hasSelection?: boolean;
  isMobile?: boolean;
  isMac?: boolean;
  focused?: boolean;
}

/** `U6` — the composer placeholder, in the official priority order. */
export function placeholderText({
  busy = false,
  suggestion,
  hasSelection = false,
  isMobile = false,
  isMac = false,
  focused = true,
}: PlaceholderInput): string {
  if (suggestion) return suggestion;
  if (busy) return "Queue another message…";
  const shortcut = isMac ? "⌘ Esc" : "ctrl esc";
  if (hasSelection && !isMobile) return `${shortcut} to attach selected text`;
  if (!focused) return "Ask Claude to edit…";
  return `${shortcut} to focus or unfocus Claude`;
}

// ------------------------------------------------------------- @-mentions

export interface TriggerMatch {
  query: string;
  start: number;
}

/**
 * `SC0` with the `@` pattern. Matches the token under the caret only, so an
 * email address mid-word does not open the file menu.
 */
export function mentionTrigger(
  text: string,
  caret: number,
): TriggerMatch | undefined {
  return matchTrigger(text, caret, /(?:^|\s)@([^\s]*)$/);
}

/** `SC0` with the `/` pattern. */
export function slashTrigger(
  text: string,
  caret: number,
): TriggerMatch | undefined {
  return matchTrigger(text, caret, /(?:^|\s)\/([^\s/]*)$/);
}

function matchTrigger(
  text: string,
  caret: number,
  pattern: RegExp,
): TriggerMatch | undefined {
  const upToCaret = text.slice(0, caret);
  const match = upToCaret.match(pattern);
  if (!match) return undefined;
  const token = match[0];
  // The leading whitespace, when present, is not part of the token.
  const offset = token.length - token.trimStart().length;
  return {
    query: match[1] ?? "",
    start: upToCaret.length - token.length + offset,
  };
}

/**
 * `q71` — the inserted mention token. A path containing whitespace is quoted
 * so the CLI receives it as one argument.
 */
export function mentionToken(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** Replaces the active trigger token with a completion. */
export function applyCompletion(
  text: string,
  trigger: TriggerMatch,
  replacement: string,
): { text: string; caret: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.start + trigger.query.length + 1);
  const next = `${before}${replacement}${after}`;
  return { text: next, caret: before.length + replacement.length };
}

/**
 * Spans of the text that are previously-inserted mentions, used by the mirror
 * layer to paint chips. The real input stays plain text, exactly as official.
 */
export function mentionSpans(
  text: string,
  inserted: ReadonlySet<string>,
): Array<{ start: number; end: number; token: string }> {
  const spans: Array<{ start: number; end: number; token: string }> = [];
  for (const token of inserted) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      spans.push({ start: at, end: at + token.length, token });
      from = at + token.length;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
