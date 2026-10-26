import type { ReadingPosition } from "@session/services/sessionTranscriptCache";

/** Capture one reading point; positions within messages use physical row boxes. */
export function captureTranscriptReadingPosition(
  element: HTMLElement,
  atBottom: boolean,
  previous?: ReadingPosition,
): ReadingPosition | undefined {
  // Following latest is authoritative even while rows leave the layout. A row
  // anchor is needed only after the user detaches from that position.
  if (atBottom)
    return {
      atBottom: true,
      offset: 0,
      // Latest restoration follows the current range, never this old offset.
      scrollTop: 0,
      format: "row",
    };
  const top = element.getBoundingClientRect().top;
  const bottom = top + element.clientHeight;
  for (const node of element.querySelectorAll<HTMLElement>(
    "[data-codex-row]",
  )) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom > top && rect.top < bottom)
      return {
        atBottom: false,
        anchor: node.dataset.codexRow ?? previous?.anchor,
        offset: top - rect.top,
        scrollTop: element.scrollTop,
        format: "row",
      };
  }
}
