import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadUserNavigationRail } from "./ThreadWorkflowToolbar";
import { useThreadWorkflowActions } from "./actions";
import { useThreadWorkflowStore } from "./delivery";

vi.mock("./service", () => ({ downloadThreadMarkdown: vi.fn() }));
// This suite asserts geometry rather than copy, so it stubs i18n instead of
// booting a catalog. `t` echoes its key with any interpolation appended, which
// keeps labels stable and distinguishable without pinning shipped strings —
// those are covered in `ThreadWorkflowToolbar.railPreview.test.tsx`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}));

/**
 * Geometry and gating taken from the shipped 26.51007.21434 webview, so the rail
 * behaves the way the plugin's own prompt rail does:
 *
 * - `thread-user-message-navigation-rail-5c89c24e73d1.js` returns null while
 *   `items.length < 4`, emits `neighborDistance` only within three rows of the
 *   active one, and gives the scroller
 *   `vertical-scroll-fade-mask … overscroll-contain [--edge-fade-distance:2.5rem]`.
 * - `floating-navigation-rail-layout-a282796ba9fb.js` sizes the marker wrapper
 *   `flex h-0.5 w-[30px] items-center`.
 */
const EDGE_FADE_DISTANCE = "2.5rem";
const MARKER_WIDTH_PX = 30;
const MINIMUM_ROWS = 4;

const userRow = (index: number) => ({
  rowId: `row-${index}`,
  itemId: `item-${index}`,
  turnId: `turn-${index}`,
  role: "user" as const,
  text: `用户消息 ${index}`,
  completed: true,
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => userRow(index));

const mount = (count: number, ...activeTurnIds: string[]) =>
  render(
    // Every rail rule is scoped under `.session-mode`, matching how the app
    // mounts it, so the harness reproduces that ancestor.
    <div className="session-mode">
      <ThreadUserNavigationRail
        rows={rows(count)}
        onNavigate={vi.fn()}
        activeTurnIds={new Set(activeTurnIds)}
      />
    </div>,
  );

const railStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "./thread-workflows.css"),
  "utf8",
);

const rail = () =>
  document.querySelector("[data-floating-navigation-rail-list]");

beforeEach(() => {
  // Geometry below is read back through getComputedStyle, so the shipped
  // stylesheet has to be present rather than assumed.
  document.head.querySelector("[data-rail-styles]")?.remove();
  const sheet = document.createElement("style");
  sheet.dataset.railStyles = "true";
  sheet.textContent = railStyles;
  document.head.append(sheet);
  vi.clearAllMocks();
  useThreadWorkflowActions.setState({ panels: {}, requests: {} });
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
});

it("stays hidden until a thread has enough turns to be worth scrubbing", () => {
  // A rail over two or three prompts is noise next to the transcript itself,
  // which is why the shipped component waits for the fourth row.
  for (let count = 1; count < MINIMUM_ROWS; count++) {
    const view = mount(count);
    expect(rail()).toBeNull();
    view.unmount();
  }
  mount(MINIMUM_ROWS);
  expect(rail()).not.toBeNull();
  expect(
    document.querySelectorAll("[data-thread-user-message-navigation-item-id]"),
  ).toHaveLength(MINIMUM_ROWS);
});

it("keeps rail scrolling and its fade inside the rail itself", () => {
  mount(MINIMUM_ROWS);
  const list = rail()!;
  const style = getComputedStyle(list);
  // Overscroll must not chain to the transcript: scrubbing the rail to its end
  // should never drag the conversation behind it.
  expect(style.overscrollBehavior).toContain("contain");
  expect(
    list.classList.contains("vertical-scroll-fade-mask") ||
      style.getPropertyValue("mask-image").trim().length > 0 ||
      style.getPropertyValue("-webkit-mask-image").trim().length > 0,
  ).toBe(true);
  expect(style.getPropertyValue("--edge-fade-distance").trim()).toBe(
    EDGE_FADE_DISTANCE,
  );
});

it("sizes each marker like the shipped rail", () => {
  mount(MINIMUM_ROWS);
  const marker = document.querySelector(
    "[data-thread-user-message-navigation-item-id] > *",
  )!;
  expect(getComputedStyle(marker).width).toBe(`${MARKER_WIDTH_PX}px`);
});

const distances = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ].map(
    (button) =>
      button.querySelector<HTMLElement>("[data-neighbor-distance]")?.dataset
        .neighborDistance ?? null,
  );

it("publishes proximity from the row under the pointer, not from the active turn", () => {
  // The shipped rail measures distance from `scrubbed ?? hovered`, so with no
  // pointer on the rail its own index is -1 and no row carries a distance.
  mount(8, "turn-2");
  expect(distances()).toEqual(Array.from({ length: 8 }, () => null));

  // Markers are addressed by their navigation attribute, as elsewhere in this
  // suite: their accessible name is localized copy, asserted in the preview
  // suite rather than here.
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  );
  fireEvent.pointerEnter(buttons[2]);
  // Hover-only sibling selectors give a touch device no falloff at all, so the
  // distance is published as data the stylesheet can read either way.
  expect(distances()).toEqual(["2", "1", "0", "1", "2", "3", null, null]);
  // `aria-current` tracks the turn actually on screen, so hovering a different
  // row must not steal it: in the shipped rail the two come from separate state.
  fireEvent.pointerEnter(buttons[5]);
  expect(buttons[2].getAttribute("aria-current")).toBe("true");
  expect(buttons[5].getAttribute("aria-current")).toBeNull();
  expect(distances()).toEqual([null, null, "3", "2", "1", "0", "1", "2"]);
});

it("marks every on-screen turn as current, not just one", () => {
  /*
   * The shipped rail keeps a Set of the turns intersecting the transcript
   * viewport and marks each of them (`"aria-current": g.has(t.id) ? "true" : void 0`
   * in `thread-user-message-navigation-rail-5c89c24e73d1.js`), rather than
   * tracking a single navigated turn. Two short prompts visible together both
   * read as current, which is what tells the user where the viewport sits.
   */
  mount(8, "turn-2", "turn-3");
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  );
  expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([
    null,
    null,
    "true",
    "true",
    null,
    null,
    null,
    null,
  ]);
});

/**
 * The rail publishes three attributes for the stylesheet to read while a finger
 * or pointer is dragged down it — `data-scrubbing` on the list,
 * `data-scrub-target` on the row under the pointer, and `data-neighbor-distance`
 * on rows within three of it. The attributes are written by
 * `ThreadUserNavigationRail`'s pointer capture; whether anything is *visible*
 * depends entirely on the stylesheet, and the two can drift apart silently
 * because the attributes keep being emitted either way.
 *
 * Codex 26.51007.21434 styles all three in
 * `floating-navigation-rail-layout-17bd6c59412b.css`:
 *
 *   [data-floating-navigation-rail-list][data-scrubbing]
 *     ._Marker_k7ebw_2[data-neighbor-distance="1"]{--marker-progress:.7}
 *   … ="2"{--marker-progress:.4}  … ="3"{--marker-progress:.2}
 *   :is(button:focus-visible,button[data-scrub-target])
 *     ._Marker_k7ebw_2{--marker-progress:1;color:var(--color-text);opacity:1}
 *   [data-floating-navigation-rail-list][data-scrubbing]
 *     :is(._MarkerLine_k7ebw_2,._BookmarkDot_k7ebw_2){transition-duration:0s}
 *
 * with marker width `scaleX(.2308 + .7692 * var(--marker-progress))`, so those
 * progress values land on the same four widths the hover siblings produce. The
 * last rule matters as much as the widths: during a drag the marker must track
 * the finger, and a .16s ease on every row would lag behind it.
 *
 * The hover rules alone cannot cover this. They are sibling-combinator based
 * (`button:hover + button`), and a touch drag never produces `:hover` on the
 * row under the finger — which is exactly the device where a scrub rail is the
 * primary way to move through a long thread.
 */
const scaleOf = (element: Element) =>
  getComputedStyle(element).transform ||
  getComputedStyle(element).getPropertyValue("transform");

const markerLines = () => [
  ...document.querySelectorAll<HTMLElement>(".codex-user-rail-marker-line"),
];

it("gives a scrub the same falloff the hover siblings get", () => {
  mount(8);
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ];
  // Drag onto row 3: pointer capture marks the list scrubbing and the row the
  // target, and publishes distances 0..3 around it.
  fireEvent.pointerDown(buttons[3], { pointerId: 1, clientY: 30 });
  const list = rail()!;
  expect(list.getAttribute("data-scrubbing")).toBe("true");
  expect(buttons[3].getAttribute("data-scrub-target")).toBe("true");

  // The taper is symmetric around the target and matches the hover widths:
  // `.2308 + .7692 * progress` at progress 1 / .7 / .4 / .2. Row 7 is four
  // rows away, outside the three-row falloff, so it stays at the resting width.
  expect(markerLines().map(scaleOf)).toEqual([
    "scaleX(0.38464)",
    "scaleX(0.53848)",
    "scaleX(0.76924)",
    "scaleX(1)",
    "scaleX(0.76924)",
    "scaleX(0.53848)",
    "scaleX(0.38464)",
    "scaleX(0.2308)",
  ]);
});

it("drops the marker transition while scrubbing so it tracks the finger", () => {
  mount(8);
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ];
  // Read the longhand: jsdom does not expand a `transition` shorthand into
  // `transitionDuration`, so a shorthand declaration reports "0s" at rest and
  // would make this assertion pass without any scrub rule existing.
  const duration = () => getComputedStyle(markerLines()[0]).transitionDuration;
  // At rest the line eases, matching the shipped .16s transition.
  expect(duration()).toBe("0.16s");
  fireEvent.pointerDown(buttons[3], { pointerId: 1, clientY: 30 });
  // Mid-drag it must be instant, or every row lags behind the pointer.
  expect(duration()).toBe("0s");
});

/**
 * This one asserts the stylesheet text rather than computed styles, because
 * jsdom cannot evaluate the thing under test: `window.matchMedia("(hover:hover)")`
 * reports `false` there and rules inside the guard never apply, so a computed
 * width cannot tell "correctly guarded" apart from "rule deleted".
 *
 * The guard matters on touch. A tap leaves `:hover` stuck on the tapped row
 * after the finger lifts, so an unguarded rule pins a bright full-width marker
 * to a row the reader has already scrolled away from. Codex 26.51007.21434
 * wraps every hover rule in `@media (hover:hover)` for the same reason
 * (`floating-navigation-rail-layout-17bd6c59412b.css`) and additionally
 * neutralizes hover mid-drag via `:not(:has([data-scrub-target]))`.
 *
 * `:focus-visible` is deliberately *outside* the guard: keyboard focus is
 * available on every device, and gating it behind a hover capability would make
 * the rail silently untraversable by keyboard on a touch screen.
 */
it("guards rail hover styling behind a hover-capable pointer", () => {
  const guardStart = railStyles.indexOf("@media (hover: hover)");
  expect(guardStart).toBeGreaterThan(-1);
  // Only the rail's own hover rules are in scope — the toolbar buttons above
  // are not a scrub surface — so match selector lines mentioning the rail, and
  // skip the comments that merely quote `:hover` in prose.
  const railHoverSelectors = railStyles
    .split("\n")
    .reduce<number[]>((found, line, index, lines) => {
      if (!line.includes(":hover") || line.trimStart().startsWith("*"))
        return found;
      // Selectors are prettier-wrapped across lines, so walk back to the rule
      // start to decide whether this hover rule belongs to the rail.
      let start = index;
      while (start > 0 && !/[{}]|^\s*$/.test(lines[start - 1])) start--;
      if (
        lines
          .slice(start, index + 1)
          .join("\n")
          .includes("codex-thread-user-rail")
      )
        found.push(index);
      return found;
    }, []);
  expect(railHoverSelectors.length).toBeGreaterThan(0);
  const guardLine = railStyles.slice(0, guardStart).split("\n").length - 1;
  for (const line of railHoverSelectors)
    expect(line).toBeGreaterThan(guardLine);

  // Keyboard focus stays reachable regardless of pointer capability. Match the
  // marker rule itself, not the bare pseudo-class: the rail's focus *outline*
  // rule also contains `button:focus-visible` and would mask its deletion.
  // Both rules must exist *and* precede the guard. Asserting only the position
  // would let a deleted rule pass: `indexOf` returns -1, which is trivially
  // less than the guard offset.
  for (const selector of [
    "button:focus-visible\n  .codex-user-rail-marker {",
    "button:focus-visible\n  .codex-user-rail-marker-line {",
  ]) {
    const index = railStyles.indexOf(selector);
    expect(index, selector).toBeGreaterThan(-1);
    expect(index, selector).toBeLessThan(guardStart);
  }

  // A stale hover must not fight the scrub taper during a drag.
  expect(railStyles).toContain(
    ".codex-thread-user-rail:not([data-scrubbing])\n    button:hover",
  );
});

/**
 * Each falloff step is expressed twice, which looks redundant until you see why
 * the shipped rail does the same. In
 * `floating-navigation-rail-layout-17bd6c59412b.css` every sibling-combinator
 * rule has an attribute twin:
 *
 *   :is(button:has(+button[data-scrub-target]),button[data-scrub-target]+button)
 *     ._Marker_k7ebw_2,
 *   [data-floating-navigation-rail-list][data-scrubbing]
 *     ._Marker_k7ebw_2[data-neighbor-distance="1"]{--marker-progress:.7}
 *
 * The combinators only reach siblings under a shared parent, and the shipped
 * rail wraps rows in `[content-visibility:auto]` chunks of 64
 * (`thread-user-message-navigation-rail-5c89c24e73d1.js`) — so at a chunk
 * boundary `button:hover + button` matches nothing and the attribute rule is
 * what keeps the taper continuous. That is what `data-neighbor-distance` is
 * for; it is not decoration.
 *
 * We render a flat list today, so only the combinators are load-bearing. Keeping
 * both means the taper survives if the list is ever chunked for the same
 * rendering reason, and it already covers touch, where `:hover` never fires.
 */
it("expresses every falloff step as both a sibling rule and an attribute rule", () => {
  for (const [distance, width] of [
    ["1", "0.76924"],
    ["2", "0.53848"],
    ["3", "0.38464"],
  ]) {
    // Prettier indents each continuation line of the wrapped selector, so build
    // the combinator chain with that indentation rather than bare newlines.
    const siblings = "\n    + button".repeat(Number(distance));
    // The combinator form, reaching forward across `distance` siblings.
    expect(railStyles, `sibling rule for distance ${distance}`).toContain(
      `button:hover${siblings}\n    .codex-user-rail-marker-line {\n    transform: scaleX(${width});`,
    );
    // The attribute form, which survives a chunk boundary.
    expect(railStyles, `attribute rule for distance ${distance}`).toContain(
      `.codex-user-rail-marker[data-neighbor-distance="${distance}"]\n    .codex-user-rail-marker-line {\n    transform: scaleX(${width});`,
    );
    // And the scrub form, outside the hover guard so touch drags get it too.
    expect(railStyles, `scrub rule for distance ${distance}`).toContain(
      `.codex-user-rail-marker[data-neighbor-distance="${distance}"]\n  .codex-user-rail-marker-line {\n  transform: scaleX(${width});`,
    );
  }
});

/**
 * Releasing a scrub has to leave the taper centered where the finger actually
 * is. The rail captures the pointer on the `<nav>` (`event.currentTarget`), and
 * per the Pointer Events spec capture retargets every event to the capturing
 * element — so while a drag is in flight no row receives `pointerenter` and the
 * `hovered` state stays frozen on the row the press began from.
 *
 * `focused` is `scrubTarget ?? hovered`, so the moment `scrubTarget` clears on
 * release the rail falls back to that frozen row. Verified in Chromium against
 * a faithful port of these handlers: pressing row 0 and dragging to row 3 leaves
 * `:hover` on row 3 once capture releases, while the published distances would
 * recenter on row 0 — two conflicting centers, and a visibly doubled taper
 * until the reader happens to move the pointer again.
 */
it("leaves the taper centered where the drag ended, not where it began", () => {
  mount(8);
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ];
  // Enter row 0 the way a pointer does before pressing, so `hovered` is set.
  fireEvent.pointerEnter(buttons[0]);
  fireEvent.pointerDown(buttons[0], { pointerId: 1, clientY: 0 });
  // Capture retargets the move to the nav, so row 3 never gets `pointerenter`.
  document.elementFromPoint = () => buttons[3];
  fireEvent.pointerMove(rail()!, { pointerId: 1, clientY: 30 });
  expect(distances()).toEqual(["3", "2", "1", "0", "1", "2", "3", null]);
  fireEvent.pointerUp(rail()!, { pointerId: 1, clientY: 30 });
  // The pointer is over row 3, so row 3 stays the center. Centering back on
  // row 0 here is what collides with the `:hover` the browser puts on row 3.
  expect(distances()).toEqual(["3", "2", "1", "0", "1", "2", "3", null]);
});

/**
 * Releasing a scrub hands the drag's last row to `hovered` so the taper stays
 * put, and `hovered` must not drag the hover card along with it. A drag is a
 * navigation gesture: the reader is already looking at the transcript jumping
 * under them, and a card appearing where their finger stopped would cover the
 * rail they are still working. The card is gated on `previewItemId`, which only
 * the debounced `openPreview` sets — this pins that separation so a later
 * refactor cannot collapse the two pieces of state back together.
 */
it("does not pop a preview card when a scrub is released", () => {
  mount(8);
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  ];
  fireEvent.pointerDown(buttons[0], { pointerId: 1, clientY: 0 });
  document.elementFromPoint = () => buttons[3];
  fireEvent.pointerMove(rail()!, { pointerId: 1, clientY: 30 });
  fireEvent.pointerUp(rail()!, { pointerId: 1, clientY: 30 });
  // The taper is centered on the row the drag ended on …
  expect(
    buttons[3]
      .querySelector("[data-neighbor-distance]")
      ?.getAttribute("data-neighbor-distance"),
  ).toBe("0");
  // … and no card is showing.
  expect(document.querySelector(".codex-user-rail-preview")).toBeNull();
});
