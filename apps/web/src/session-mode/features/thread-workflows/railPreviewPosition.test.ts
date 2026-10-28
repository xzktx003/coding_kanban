import { expect, it } from "vitest";
import { railPreviewPosition } from "./railPreviewPosition";

/**
 * Codex 26.51007.21434 anchors the rail's hover card with
 * `thread-user-message-navigation-rail-5c89c24e73d1.js`:
 *
 *   jsx(Re, { align: `center`, delayOpen: !0, interactive: ze,
 *     portalContainer: s, positioningElement: Be, side: `right`, sideOffset: 0,
 *     skipDelayKey: `thread-user-message-navigation`,
 *     tooltipMaxWidth: `min(20rem, calc(100vw - 16px))`,
 *     variant: `floating-navigation-rail`, … })
 *
 * So the card sits to the marker's right edge with no gap, is centred on the
 * marker vertically, and is capped at 20rem or the viewport minus 16px.
 *
 * It is portalled (`portalContainer`) rather than nested in the marker, because
 * the rail itself scrolls: our `.codex-thread-user-rail` is `overflow-y: auto`
 * with a fade `mask`, so a card rendered inside a rail button is clipped by both.
 * These are the numbers that let the portalled card track the marker.
 */
const viewport = { left: 0, top: 0, width: 1440, height: 900 };

it("places the card against the marker's right edge, centred on it", () => {
  const style = railPreviewPosition(
    { left: 12, right: 48, top: 400, bottom: 410 },
    viewport,
  );
  expect(style.position).toBe("fixed");
  // `sideOffset: 0` — the card starts exactly where the marker ends.
  expect(style.left).toBe(48);
  // `align: "center"` — the marker's midpoint (405) drives vertical placement.
  expect(style.top).toBe(405);
  expect(style.transform).toBe("translateY(-50%)");
});

it("caps width at 20rem, or the viewport minus 16px on a narrow screen", () => {
  const wide = railPreviewPosition(
    { left: 12, right: 48, top: 10, bottom: 20 },
    viewport,
  );
  expect(wide.maxWidth).toBe(320);
  const narrow = railPreviewPosition(
    { left: 12, right: 48, top: 10, bottom: 20 },
    { left: 0, top: 0, width: 300, height: 600 },
  );
  // 300 - 16 = 284, below 20rem, so the viewport wins.
  expect(narrow.maxWidth).toBe(284);
});

it("keeps the card inside the viewport when the marker sits near an edge", () => {
  // A marker whose right edge leaves less than the 16px gutter cannot host a
  // card at `left: right`; it must come back inside rather than overflow.
  const style = railPreviewPosition(
    { left: 1400, right: 1436, top: 400, bottom: 410 },
    viewport,
  );
  expect(Number(style.left) + Number(style.maxWidth)).toBeLessThanOrEqual(
    viewport.width - 8,
  );
});

it("offsets by the visual viewport so pinch-zoom does not detach the card", () => {
  const style = railPreviewPosition(
    { left: 12, right: 48, top: 400, bottom: 410 },
    { left: 40, top: 60, width: 800, height: 500 },
  );
  // The anchor rect is already viewport-relative, so only the clamp bounds move.
  expect(style.left).toBe(48);
  expect(style.maxWidth).toBe(320);
});
