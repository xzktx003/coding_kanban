import { expect, test } from "vitest";
import {
  calendarDay,
  compactionSummary,
  dateDividerLabel,
  dotClassName,
  exploredLabel,
  fullTimestamp,
  interruptLabel,
  isFoldableBlock,
  isReadishToolName,
  narrationHintSuffix,
  needsDateDivider,
  resolveSpinnerVerbs,
  settledText,
  shortTimestamp,
  shouldFoldGroup,
  showsMessageActions,
  spinnerModeClass,
  SPINNER_FRAMES,
  SPINNER_FRAME_MS,
  SPINNER_REDUCED_MOTION_GLYPH,
  SPINNER_VERBS,
  statusVerb,
  thinkingLabel,
} from "./stream";

// Ground truth: docs/designs/claude-render-alignment/message-stream-contract-20261027.md

test("interrupt markers map to their friendly labels", () => {
  expect(interruptLabel("[Request interrupted by user]")).toBe("Interrupted");
  expect(interruptLabel("[Request interrupted by user for tool use]")).toBe(
    "Tool interrupted",
  );
  expect(interruptLabel("some other text")).toBeUndefined();
});

test("thinking and text blocks always fold", () => {
  expect(isFoldableBlock({ type: "thinking" })).toBe(true);
  expect(isFoldableBlock({ type: "text" })).toBe(true);
  expect(isFoldableBlock({ type: "redacted_thinking" })).toBe(true);
});

test("only read-only tool calls fold", () => {
  for (const name of ["Read", "Grep", "Search", "TodoWrite", "Glob", "ReadCoalesced"])
    expect(isFoldableBlock({ type: "tool_use", name }), name).toBe(true);

  // Mutating tools must stay visible rather than hide inside "Explored N".
  for (const name of ["Bash", "Edit", "Write"])
    expect(isFoldableBlock({ type: "tool_use", name }), name).toBe(false);
});

test("read-ish names fold via the heuristic, covering MCP tools", () => {
  expect(isReadishToolName("mcp__github__list_issues")).toBe(true);
  expect(isReadishToolName("mcp__x__fetch_page")).toBe(true);
  expect(isReadishToolName("mcp__x__delete_repo")).toBe(false);
  expect(isFoldableBlock({ type: "tool_use", name: "mcp__x__get_thing" })).toBe(
    true,
  );
  expect(
    isFoldableBlock({ type: "tool_use", name: "mcp__x__create_thing" }),
  ).toBe(false);
});

test("failed tool results do not fold away", () => {
  expect(isFoldableBlock({ type: "tool_result" })).toBe(true);
  expect(isFoldableBlock({ type: "tool_result", is_error: false })).toBe(true);
  // An error must not be hidden inside a collapsed group.
  expect(isFoldableBlock({ type: "tool_result", is_error: true })).toBe(false);
});

test("a group only collapses when it is worth hiding", () => {
  expect(shouldFoldGroup(1, 1)).toBe(false);
  expect(shouldFoldGroup(2, 1)).toBe(false);
  expect(shouldFoldGroup(2, 2)).toBe(true);
  expect(shouldFoldGroup(5, 4)).toBe(true);
});

test("the explored header counts tool calls", () => {
  expect(exploredLabel(3)).toBe("Explored 3");
});

test("timeline dot classes cover every state", () => {
  expect(dotClassName("success")).toBe("claude-dot-success");
  expect(dotClassName("failure")).toBe("claude-dot-failure");
  expect(dotClassName("warning")).toBe("claude-dot-warning");
  expect(dotClassName("progress")).toBe("claude-dot-progress");
});

test("thinking label reflects streaming and elapsed time", () => {
  expect(thinkingLabel({ isThinking: true })).toBe("Thinking...");
  expect(thinkingLabel({ isThinking: true, durationMillis: 4000 })).toBe(
    "Thinking...",
  );
  expect(thinkingLabel({ isThinking: false, durationMillis: 4400 })).toBe(
    "Thought for 4s",
  );
  expect(thinkingLabel({ isThinking: false, durationMillis: 4600 })).toBe(
    "Thought for 5s",
  );
  expect(thinkingLabel({ isThinking: false })).toBe("Thinking");
});

test("narration hints add a suffix, and hidden adds nothing", () => {
  expect(narrationHintSuffix("summary")).toBe(" · summary");
  expect(narrationHintSuffix("summarized")).toBe(" · summarized");
  expect(narrationHintSuffix("hidden")).toBeNull();
  expect(narrationHintSuffix(undefined)).toBeNull();
});

test("the spinner cycles twelve frames at the official interval", () => {
  expect(SPINNER_FRAMES).toHaveLength(12);
  expect(SPINNER_FRAMES[0]).toBe("·");
  expect(SPINNER_FRAMES[5]).toBe("✽");
  // The sequence runs forward then back, so it reverses at the midpoint.
  expect(SPINNER_FRAMES[6]).toBe("✽");
  expect(SPINNER_FRAMES[11]).toBe("·");
  expect(SPINNER_FRAME_MS).toBe(120);
  expect(SPINNER_REDUCED_MOTION_GLYPH).toBe("✻");
});

test("spinner verbs can be appended to or replaced", () => {
  expect(SPINNER_VERBS.length).toBeGreaterThan(70);
  expect(SPINNER_VERBS).toContain("Clauding");
  expect(SPINNER_VERBS).toContain("Reticulating");

  expect(resolveSpinnerVerbs(undefined)).toBe(SPINNER_VERBS);
  const appended = resolveSpinnerVerbs({ mode: "append", verbs: ["Yakking"] });
  expect(appended).toContain("Yakking");
  expect(appended).toContain("Clauding");

  const replaced = resolveSpinnerVerbs({ mode: "replace", verbs: ["Only"] });
  expect(replaced).toEqual(["Only"]);
  // An empty custom list must not blank out the spinner.
  expect(resolveSpinnerVerbs({ mode: "replace", verbs: [] })).toBe(
    SPINNER_VERBS,
  );
});

test("status verbs override the random verb", () => {
  expect(statusVerb("compacting")).toBe("Compacting");
  expect(statusVerb("startup_hooks")).toBe("Running start-up hooks");
  expect(statusVerb("prompt_submit_hooks")).toBe(
    "Running UserPromptSubmit hooks",
  );
  expect(statusVerb("working")).toBeUndefined();
  expect(statusVerb(undefined)).toBeUndefined();
});

test("spinner color follows the permission mode", () => {
  expect(spinnerModeClass("acceptEdits")).toBe("claude-spinner-accept");
  expect(spinnerModeClass("plan")).toBe("claude-spinner-plan");
  // Both of the dangerous modes share the error color.
  expect(spinnerModeClass("bypassPermissions")).toBe("claude-spinner-danger");
  expect(spinnerModeClass("auto")).toBe("claude-spinner-danger");
  expect(spinnerModeClass("default")).toBe("claude-spinner-default");
  expect(spinnerModeClass(undefined)).toBe("claude-spinner-default");
});

test("timestamps use the official short and full formats", () => {
  // 2026-01-05T15:45:30Z, pinned to UTC so the assertion is stable.
  const date = new Date("2026-01-05T15:45:30Z");
  expect(shortTimestamp(date, "UTC")).toBe("3:45 PM");
  expect(fullTimestamp(date, "UTC")).toBe("2026-01-05 15:45:30");
});

test("the calendar day drives date dividers, not the raw timestamp", () => {
  const day = calendarDay(new Date("2026-01-05T15:45:30Z"), "UTC");
  expect(day).toBe("2026-01-05");

  const morning = new Date("2026-01-05T08:00:00Z");
  const evening = new Date("2026-01-05T22:00:00Z");
  const nextDay = new Date("2026-01-06T01:00:00Z");

  expect(needsDateDivider(morning, undefined, "UTC")).toBe(true);
  expect(needsDateDivider(evening, morning, "UTC")).toBe(false);
  expect(needsDateDivider(nextDay, evening, "UTC")).toBe(true);
});

test("the date divider shows a year only outside the current one", () => {
  const date = new Date("2026-01-05T12:00:00Z");
  const sameYear = new Date("2026-06-01T12:00:00Z");
  const laterYear = new Date("2027-06-01T12:00:00Z");

  expect(dateDividerLabel(date, sameYear, "UTC")).toBe("Mon, Jan 5");
  expect(dateDividerLabel(date, laterYear, "UTC")).toContain("2026");
});

test("message actions appear on every finished assistant message", () => {
  const base = {
    type: "assistant",
    hasText: true,
    isPartial: false,
  };
  expect(showsMessageActions(base)).toBe(true);

  // There is deliberately no "most recent turn" condition, so an older
  // finished message still gets its actions.
  expect(showsMessageActions({ ...base, status: "done" })).toBe(true);
});

test("message actions are withheld while streaming or for sub-agents", () => {
  const base = { type: "assistant", hasText: true, isPartial: false };
  expect(showsMessageActions({ ...base, isPartial: true })).toBe(false);
  expect(showsMessageActions({ ...base, status: "progress" })).toBe(false);
  expect(showsMessageActions({ ...base, parentToolUseId: "tu-1" })).toBe(false);
  expect(showsMessageActions({ ...base, isSynthetic: true })).toBe(false);
  expect(showsMessageActions({ ...base, readOnly: true })).toBe(false);
  expect(showsMessageActions({ ...base, hasText: false })).toBe(false);
  expect(showsMessageActions({ ...base, type: "user" })).toBe(false);
});

test("the compaction notice reports the trigger and tokens freed", () => {
  expect(compactionSummary("manual", 12400)).toBe(
    "Compacted chat · manual · 12k tokens freed",
  );
  expect(compactionSummary("auto", 50000)).toBe(
    "Compacted chat · auto · 50k tokens freed",
  );
});

test("streaming text is trimmed to its last settled block", () => {
  // An unfinished trailing paragraph is held back so it is not re-parsed
  // on every token.
  expect(settledText("done para\n\nstill typing")).toBe("done para");
  expect(settledText("a\n\nb\n\nc in progress")).toBe("a\n\nb");
  // Nothing has settled yet.
  expect(settledText("first paragraph still going")).toBe("");
  expect(settledText("")).toBe("");
});
