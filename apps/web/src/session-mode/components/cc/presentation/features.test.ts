import { expect, test } from "vitest";
import {
  archivableSessions,
  ClosedSessionRing,
  compactionNotice,
  COMPACTION_FALLBACK,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  focusViewClass,
  isFocusViewShortcut,
  isNewConversationShortcut,
  isReopenShortcut,
  nextRating,
  RATING_LABELS,
  showsRating,
} from "./features";

// Ground truth: docs/designs/claude-render-alignment/plan-20261027.md §5

test("focus view toggles a single scoping class", () => {
  expect(focusViewClass(true)).toBe("claude-focus-view");
  expect(focusViewClass(false)).toBe("");
});

test("the official shortcuts are matched exactly", () => {
  // ctrl+alt+f
  expect(isFocusViewShortcut({ key: "f", ctrl: true, alt: true })).toBe(true);
  expect(isFocusViewShortcut({ key: "F", ctrl: true, alt: true })).toBe(true);
  expect(isFocusViewShortcut({ key: "f", ctrl: true })).toBe(false);
  expect(isFocusViewShortcut({ key: "f", alt: true })).toBe(false);
  // A stray shift must not trigger it.
  expect(
    isFocusViewShortcut({ key: "f", ctrl: true, alt: true, shift: true }),
  ).toBe(false);
});

test("reopen and new-conversation shortcuts accept either platform modifier", () => {
  // cmd+shift+t / ctrl+shift+t
  expect(isReopenShortcut({ key: "t", meta: true, shift: true })).toBe(true);
  expect(isReopenShortcut({ key: "t", ctrl: true, shift: true })).toBe(true);
  expect(isReopenShortcut({ key: "t", ctrl: true })).toBe(false);

  // cmd+n / ctrl+n, but not with shift
  expect(isNewConversationShortcut({ key: "n", meta: true })).toBe(true);
  expect(isNewConversationShortcut({ key: "n", ctrl: true })).toBe(true);
  expect(
    isNewConversationShortcut({ key: "n", ctrl: true, shift: true }),
  ).toBe(false);
});

test("the closed-session ring returns the most recent first", () => {
  const ring = new ClosedSessionRing();
  ring.push("a");
  ring.push("b");
  expect(ring.peek()).toBe("b");
  expect(ring.pop()).toBe("b");
  expect(ring.pop()).toBe("a");
  expect(ring.pop()).toBeUndefined();
});

test("re-closing a session moves it to the front instead of duplicating", () => {
  const ring = new ClosedSessionRing();
  ring.push("a");
  ring.push("b");
  ring.push("a");
  expect(ring.size).toBe(2);
  expect(ring.pop()).toBe("a");
  expect(ring.pop()).toBe("b");
});

test("the ring is bounded so it cannot grow without limit", () => {
  const ring = new ClosedSessionRing(3);
  for (const id of ["a", "b", "c", "d"]) ring.push(id);
  expect(ring.size).toBe(3);
  // The oldest entry is dropped, not the newest.
  expect(ring.pop()).toBe("d");
});

test("a reopened session can be forgotten", () => {
  const ring = new ClosedSessionRing();
  ring.push("a");
  ring.push("b");
  ring.forget("b");
  expect(ring.pop()).toBe("a");
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

test("only sessions idle past the cutoff are archivable", () => {
  const sessions = [
    { id: "old", updatedAt: NOW - 40 * DAY },
    { id: "fresh", updatedAt: NOW - 2 * DAY },
  ];
  expect(archivableSessions(sessions, NOW)).toEqual(["old"]);
  expect(archivableSessions(sessions, NOW, 60)).toEqual([]);
  expect(DEFAULT_ARCHIVE_AFTER_DAYS).toBe(30);
});

test("a running session is never archived however old it looks", () => {
  // Archiving a live conversation would be destructive.
  const sessions = [
    { id: "busy", updatedAt: NOW - 400 * DAY, running: true },
    { id: "idle", updatedAt: NOW - 400 * DAY },
  ];
  expect(archivableSessions(sessions, NOW)).toEqual(["idle"]);
});

test("already-archived sessions are not re-archived", () => {
  const sessions = [{ id: "done", updatedAt: NOW - 90 * DAY, archived: true }];
  expect(archivableSessions(sessions, NOW)).toEqual([]);
});

test("a non-positive threshold disables archiving entirely", () => {
  // Guards against a misconfiguration sweeping every session.
  const sessions = [{ id: "x", updatedAt: 0 }];
  expect(archivableSessions(sessions, NOW, 0)).toEqual([]);
  expect(archivableSessions(sessions, NOW, -1)).toEqual([]);
  expect(archivableSessions(sessions, NOW, Number.NaN)).toEqual([]);
});

test("the compaction notice reports the trigger and tokens freed", () => {
  expect(
    compactionNotice({ trigger: "manual", tokensFreed: 12_400 }),
  ).toEqual({
    title: "Compacted chat · manual · 12k tokens freed",
    body: COMPACTION_FALLBACK,
  });
  expect(
    compactionNotice({
      trigger: "auto",
      tokensFreed: 50_000,
      summary: "  We discussed the renderer.  ",
    }),
  ).toEqual({
    title: "Compacted chat · auto · 50k tokens freed",
    body: "We discussed the renderer.",
  });
});

test("a blank summary falls back rather than showing emptiness", () => {
  expect(
    compactionNotice({ trigger: "auto", tokensFreed: 1000, summary: "   " })
      .body,
  ).toBe(COMPACTION_FALLBACK);
});

test("rating labels match the official accessible names", () => {
  expect(RATING_LABELS.positive).toBe("Good response");
  expect(RATING_LABELS.negative).toBe("Bad response");
});

test("clicking the active rating clears it", () => {
  expect(nextRating(undefined, "positive")).toBe("positive");
  expect(nextRating("positive", "positive")).toBeUndefined();
  expect(nextRating("positive", "negative")).toBe("negative");
});

test("rating stays hidden unless the gate and both opt-outs allow it", () => {
  expect(showsRating({ experimentEnabled: true })).toBe(true);
  expect(showsRating({})).toBe(false);
  expect(
    showsRating({ experimentEnabled: true, analyticsDisabled: true }),
  ).toBe(false);
  expect(
    showsRating({ experimentEnabled: true, productFeedbackDisabled: true }),
  ).toBe(false);
});
