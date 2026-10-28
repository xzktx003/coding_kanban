/**
 * Message-stream rules, aligned with the official Claude Code VS Code
 * extension 2.1.311.
 *
 * Reference: docs/designs/claude-render-alignment/message-stream-contract-20261027.md
 */

/** The interrupt markers the CLI injects, and their display text (`rj`). */
const INTERRUPT_TEXT: Record<string, string> = {
  "[Request interrupted by user]": "Interrupted",
  "[Request interrupted by user for tool use]": "Tool interrupted",
};

/** `X3` — maps an interrupt marker to its friendly label. */
export function interruptLabel(text: string): string | undefined {
  return INTERRUPT_TEXT[text.trim()];
}

/** Tools the official grouper folds into an "Explored N" row. */
const FOLDABLE_TOOLS = new Set([
  "Read",
  "Grep",
  "Search",
  "TodoWrite",
  "Glob",
  "ReadCoalesced",
]);

/** `Fb5` — the read-ish name heuristic for MCP and unknown tools. */
const READISH = ["read", "get", "list", "search", "fetch"];

export function isReadishToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return READISH.some((verb) => lower.includes(verb));
}

export interface FoldableBlock {
  type: string;
  name?: string;
  is_error?: boolean;
}

/**
 * `Jk0` — whether a single content block may fold into an explored group.
 * Thinking and text always fold; tool calls only when they are read-only;
 * tool results fold unless they failed.
 */
export function isFoldableBlock(block: FoldableBlock): boolean {
  if (
    block.type === "thinking" ||
    block.type === "text" ||
    block.type === "redacted_thinking"
  )
    return true;

  if (block.type === "tool_use") {
    const name = block.name ?? "";
    return FOLDABLE_TOOLS.has(name) || isReadishToolName(name);
  }

  if (block.type === "tool_result") return !block.is_error;

  return false;
}

/** The "Explored N" header text. */
export function exploredLabel(toolCallCount: number): string {
  return `Explored ${toolCallCount}`;
}

/**
 * A run of foldable messages only collapses when it is long enough to be
 * worth hiding: at least two messages and more than one tool call.
 */
export function shouldFoldGroup(
  messageCount: number,
  toolCallCount: number,
): boolean {
  return messageCount >= 2 && toolCallCount > 1;
}

/** Timeline dot state, which drives the `:before` color on a message. */
export type DotState = "success" | "failure" | "warning" | "progress";

export function dotClassName(state: DotState): string {
  return `claude-dot-${state}`;
}

// ------------------------------------------------------------------ thinking

export interface ThinkingLabelOptions {
  isThinking: boolean;
  durationMillis?: number;
}

/** The thinking summary line's label. */
export function thinkingLabel({
  isThinking,
  durationMillis,
}: ThinkingLabelOptions): string {
  if (isThinking) return "Thinking...";
  if (durationMillis !== undefined && durationMillis > 0)
    return `Thought for ${Math.round(durationMillis / 1000)}s`;
  return "Thinking";
}

/** Narration-signed thinking gets a trailing hint instead of a toggle. */
export function narrationHintSuffix(hint: string | undefined): string | null {
  if (hint === "summary") return " · summary";
  if (hint === "summarized") return " · summarized";
  return null;
}

// ------------------------------------------------------------------- spinner

/** The official spinner glyph cycle: forward then reversed, 12 frames. */
const SPINNER_GLYPHS = ["·", "✢", "*", "✶", "✻", "✽"] as const;

export const SPINNER_FRAMES: readonly string[] = [
  ...SPINNER_GLYPHS,
  ...[...SPINNER_GLYPHS].reverse(),
];

/** Frame interval in milliseconds. */
export const SPINNER_FRAME_MS = 120;

/** The glyph shown when motion is reduced (`gE1[4]`). */
export const SPINNER_REDUCED_MOTION_GLYPH = "✻";

/** `SE1` — the default verb list. */
export const SPINNER_VERBS: readonly string[] = [
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping",
  "Brewing", "Calculating", "Cerebrating", "Channeling", "Churning",
  "Clauding", "Coalescing", "Cogitating", "Computing", "Combobulating",
  "Concocting", "Considering", "Contemplating", "Cooking", "Crafting",
  "Creating", "Crunching", "Deciphering", "Deliberating", "Determining",
  "Discombobulating", "Doing", "Effecting", "Elucidating", "Enchanting",
  "Envisioning", "Finagling", "Flibbertigibbeting", "Forging", "Forming",
  "Frolicking", "Generating", "Germinating", "Hatching", "Herding",
  "Honking", "Ideating", "Imagining", "Incubating", "Inferring",
  "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling",
  "Mustering", "Noodling", "Percolating", "Perusing", "Philosophizing",
  "Pontificating", "Pondering", "Processing", "Puttering", "Puzzling",
  "Reticulating", "Ruminating", "Schlepping", "Shimmying", "Simmering",
  "Smooshing", "Spelunking", "Spinning", "Stewing", "Sussing",
  "Synthesizing", "Thinking", "Tinkering", "Transmuting", "Unfurling",
  "Unraveling", "Vibing", "Wandering", "Whirring", "Wibbling",
  "Working", "Wrangling",
];

export interface SpinnerVerbSetting {
  mode: "append" | "replace";
  verbs: string[];
}

/** `Qb5` — applies the user's spinnerVerbs setting to the default list. */
export function resolveSpinnerVerbs(
  setting?: SpinnerVerbSetting,
): readonly string[] {
  if (!setting || !Array.isArray(setting.verbs) || setting.verbs.length === 0)
    return SPINNER_VERBS;
  if (setting.mode === "replace") return setting.verbs;
  return [...SPINNER_VERBS, ...setting.verbs];
}

/** Status-specific verbs that replace the random one outright. */
export function statusVerb(status: string | undefined): string | undefined {
  if (status === "compacting") return "Compacting";
  if (status === "startup_hooks") return "Running start-up hooks";
  if (status === "prompt_submit_hooks")
    return "Running UserPromptSubmit hooks";
  return undefined;
}

/** The spinner glyph color varies by permission mode. */
export function spinnerModeClass(permissionMode: string | undefined): string {
  switch (permissionMode) {
    case "acceptEdits":
      return "claude-spinner-accept";
    case "plan":
      return "claude-spinner-plan";
    case "bypassPermissions":
    case "auto":
      return "claude-spinner-danger";
    default:
      return "claude-spinner-default";
  }
}

// ---------------------------------------------------------------- timestamps

/** The short timestamp label: `3:45 PM`. */
export function shortTimestamp(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/** The hover label: `YYYY-MM-DD HH:mm:ss`, 24-hour. */
export function fullTimestamp(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** The local calendar day, used to decide where a date divider goes. */
export function calendarDay(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The divider label: `Mon, Jan 5`, with a year when it is not the current one. */
export function dateDividerLabel(
  date: Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const sameYear =
    calendarDay(date, timeZone).slice(0, 4) ===
    calendarDay(now, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone,
  }).format(date);
}

/** Whether a date divider belongs before this message. */
export function needsDateDivider(
  current: Date,
  previous: Date | undefined,
  timeZone?: string,
): boolean {
  if (!previous) return true;
  return calendarDay(current, timeZone) !== calendarDay(previous, timeZone);
}

// ------------------------------------------------------- message actions

export interface ActionGateInput {
  type: string;
  hasText: boolean;
  isPartial: boolean;
  isSynthetic?: boolean;
  parentToolUseId?: string;
  status?: string;
  readOnly?: boolean;
}

/**
 * `VE1` plus its call-site guard. Note there is deliberately no
 * "most recent turn" condition: every finished assistant message gets
 * its action row.
 */
export function showsMessageActions(message: ActionGateInput): boolean {
  if (message.type !== "assistant") return false;
  if (!message.hasText) return false;
  if (message.readOnly) return false;
  if (message.status === "progress") return false;
  if (message.isPartial) return false;
  if (message.isSynthetic) return false;
  if (message.parentToolUseId) return false;
  return true;
}

// ------------------------------------------------------------- compaction

/** The compaction notice summary line. */
export function compactionSummary(
  trigger: "manual" | "auto",
  tokensFreed: number,
): string {
  return `Compacted chat · ${trigger} · ${Math.round(tokensFreed / 1000)}k tokens freed`;
}

export const COMPACTION_FALLBACK_TEXT =
  "Conversation was compacted to free up context.";

// -------------------------------------------------------------- streaming

/**
 * `g_1` — trims streaming text to its last settled block so an unfinished
 * paragraph or fence is not re-parsed as it grows.
 */
export function settledText(text: string): string {
  if (!text) return text;
  const lastBreak = text.lastIndexOf("\n\n");
  if (lastBreak === -1) return "";
  return text.slice(0, lastBreak);
}
