import type { CSSProperties } from "react";

/** `tooltipMaxWidth: "min(20rem, calc(100vw - 16px))"` — 20rem at our 16px root. */
const PREVIEW_MAX_WIDTH = 320;
/** The `calc(100vw - 16px)` half of that cap, split as an 8px gutter per side. */
const VIEWPORT_GUTTER = 8;

/**
 * Position the rail's hover card the way Codex 26.51007.21434 does:
 * `side: "right"` with `sideOffset: 0` puts it flush against the marker's right
 * edge, and `align: "center"` lines its midline up with the marker's.
 *
 * The card is portalled out of the rail rather than nested inside a marker
 * button, so it needs explicit coordinates: `.codex-thread-user-rail` is
 * `overflow-y: auto` under a fade `mask`, either of which would cut a nested
 * card off. `anchor` is a viewport-relative `getBoundingClientRect()`, so only
 * the clamp bounds consult the visual viewport.
 */
export function railPreviewPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; top: number; width: number; height: number },
): CSSProperties {
  const maxWidth = Math.min(
    PREVIEW_MAX_WIDTH,
    Math.max(0, viewport.width - VIEWPORT_GUTTER * 2),
  );
  // A marker close to the right edge would push the card off-screen; pull it
  // back so the full cap still fits inside the gutter.
  const left = Math.max(
    viewport.left + VIEWPORT_GUTTER,
    Math.min(
      anchor.right,
      viewport.left + viewport.width - VIEWPORT_GUTTER - maxWidth,
    ),
  );
  return {
    position: "fixed",
    left,
    top: (anchor.top + anchor.bottom) / 2,
    transform: "translateY(-50%)",
    maxWidth,
  };
}
