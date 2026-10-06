import type { CSSProperties } from "react";
export function suggestionPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: {
    left: number;
    top: number;
    width: number;
    height: number;
    layoutHeight?: number;
  },
): CSSProperties {
  const margin = 12;
  const gap = 8;
  const width = Math.min(460, Math.max(0, viewport.width - margin * 2));
  const left = Math.max(
    viewport.left + margin,
    Math.min(anchor.left, viewport.left + viewport.width - margin - width),
  );
  const above = Math.max(0, anchor.top - viewport.top - margin - gap);
  const below = Math.max(
    0,
    viewport.top + viewport.height - anchor.bottom - margin - gap,
  );
  return {
    position: "fixed",
    left,
    width,
    maxHeight: Math.min(
      viewport.width <= 480 ? 360 : 420,
      Math.max(above, below),
    ),
    ...(above >= below
      ? {
          bottom:
            (viewport.layoutHeight ?? viewport.top + viewport.height) -
            anchor.top +
            gap,
        }
      : { top: anchor.bottom + gap }),
  };
}
