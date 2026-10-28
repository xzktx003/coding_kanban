import { expect, it } from "vitest";
import { visibleTurnIds } from "./visibleTurns";

/**
 * Codex 26.51007.21434 decides which rail markers read as current with an
 * IntersectionObserver over the transcript
 * (`thread-user-message-navigation-rail-5c89c24e73d1.js`):
 *
 *   new IntersectionObserver(…, { root: e, rootMargin: `-${At}px 0px 0px 0px` })
 *   // At = 16
 *
 * and then marks every turn in the resulting set
 * (`"aria-current": g.has(t.id) ? "true" : void 0`). The observer's default
 * threshold is 0, so a partly visible turn counts, and the negative top margin
 * pulls the top edge down 16px — a turn scrolled almost out of frame stops
 * being current slightly before it leaves.
 *
 * Our transcript is virtualized, so the same set is already local: each virtual
 * item carries its own offsets. That makes this a pure function over them
 * rather than a second observer racing the virtualizer.
 */
const row = (start: number, end: number, turnId: string | undefined) => ({
  start,
  end,
  turnId,
});

it("marks every turn overlapping the viewport", () => {
  const visible = visibleTurnIds(
    [
      row(0, 100, "turn-0"),
      row(100, 200, "turn-1"),
      row(200, 300, "turn-2"),
      row(300, 400, "turn-3"),
    ],
    { scrollOffset: 150, height: 100 },
  );
  // 150..250 touches turn-1 (100..200) and turn-2 (200..300).
  expect([...visible].sort()).toEqual(["turn-1", "turn-2"]);
});

it("drops a turn once it is within the 16px top margin", () => {
  // turn-0 ends at 100; a viewport starting at 90 leaves only 10px of it
  // showing, inside `rootMargin: -16px`, so official stops counting it.
  expect([
    ...visibleTurnIds([row(0, 100, "turn-0"), row(100, 300, "turn-1")], {
      scrollOffset: 90,
      height: 200,
    }),
  ]).toEqual(["turn-1"]);
  // At 80 there is 20px left, beyond the margin, so it still counts.
  expect(
    [
      ...visibleTurnIds([row(0, 100, "turn-0"), row(100, 300, "turn-1")], {
        scrollOffset: 80,
        height: 200,
      }).values(),
    ].sort(),
  ).toEqual(["turn-0", "turn-1"]);
});

it("ignores rows that belong to no turn", () => {
  const visible = visibleTurnIds(
    [row(0, 100, undefined), row(100, 200, "turn-1")],
    { scrollOffset: 0, height: 200 },
  );
  expect([...visible]).toEqual(["turn-1"]);
});

it("collapses repeated rows of one turn to a single entry", () => {
  // A turn spans a prompt plus its activity rows; the rail has one marker.
  const visible = visibleTurnIds(
    [row(0, 50, "turn-0"), row(50, 90, "turn-0"), row(90, 140, "turn-1")],
    { scrollOffset: 0, height: 200 },
  );
  expect([...visible].sort()).toEqual(["turn-0", "turn-1"]);
  expect(visible.size).toBe(2);
});

it("returns nothing when the viewport has no height yet", () => {
  // Before first layout the transcript reports zero height; marking every turn
  // current there would light the whole rail on mount.
  expect(
    visibleTurnIds([row(0, 100, "turn-0")], { scrollOffset: 0, height: 0 })
      .size,
  ).toBe(0);
});
