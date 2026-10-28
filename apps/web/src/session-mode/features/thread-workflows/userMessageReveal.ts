/**
 * The post-jump reveal flash, ported from the shipped 26.51007.21434 webview's
 * `thread-user-message-navigation-rail-5c89c24e73d1.js`: after the rail scrolls
 * a user message into view, its bubble holds an emphasis tint and then decays
 * back to rest, so the eye can find the row the jump landed on.
 *
 * The plugin's own end keyframe is a 5% text mix because that is what its bubble
 * rests on. Ours rests on `--codex-secondary`, so the decay targets that token
 * instead; mixing to 5% here would end the animation on a colour the bubble
 * never actually has and leave a visible step when the animation is released.
 */
const EMPHASIS_BACKGROUND =
  "color-mix(in srgb, var(--codex-text) 14%, var(--codex-secondary))";
const RESTING_BACKGROUND = "var(--codex-secondary)";

/** The plugin holds the emphasis for this fraction of the run before decaying. */
const EMPHASIS_HOLD_OFFSET = 0.35;

export const REVEAL_FLASH_DURATION_MS = 1400;
export const REVEAL_FLASH_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Flashes the bubble inside an already-scrolled row.
 *
 * The attachment-pill fallback is the plugin's, kept for parity: there is no
 * producer of `[data-composer-attachment-pill]` in session mode today, because
 * our rows render attachments *inside* the bubble, so the first selector already
 * covers attachment-only messages. The reachable no-target case here is an
 * inline-edited row, which renders the editor instead of a bubble and is
 * correctly left unflashed.
 *
 * Hosts without the Web Animations API (jsdom, older webviews) are left
 * untouched rather than throwing mid-navigation, which is why the plugin guards
 * the call too.
 */
export function revealUserMessageFlash(
  row: Element | null | undefined,
  reducedMotion = false,
): void {
  const target =
    row?.querySelector("[data-user-message-bubble]") ??
    row?.querySelector("[data-composer-attachment-pill]");
  target?.animate?.(
    [
      { backgroundColor: EMPHASIS_BACKGROUND },
      { backgroundColor: EMPHASIS_BACKGROUND, offset: EMPHASIS_HOLD_OFFSET },
      { backgroundColor: RESTING_BACKGROUND },
    ],
    {
      duration: reducedMotion ? 0 : REVEAL_FLASH_DURATION_MS,
      easing: REVEAL_FLASH_EASING,
    },
  );
}

/** Matches how the rest of session mode reads the user's motion preference. */
export function prefersReducedMotion(view?: Window | null): boolean {
  const target = view ?? (typeof window === "undefined" ? null : window);
  return Boolean(
    target?.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

/** Frames to poll for a row the virtualizer has not mounted yet. */
const MOUNT_WAIT_FRAMES = 10;

/**
 * Flashes the jumped-to row once it exists. The plugin flashes synchronously
 * because its transcript is fully rendered; ours is virtualized, so the row can
 * appear a frame or two after `scrollToIndex`. Polling stops at the first hit and
 * after a bounded number of frames, so a folded or dropped row cannot spin.
 */
export function flashRowWhenMounted({
  findRow,
  reducedMotion = false,
  requestFrame = requestAnimationFrame,
  frames = MOUNT_WAIT_FRAMES,
}: {
  findRow: () => Element | null | undefined;
  reducedMotion?: boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  frames?: number;
}): void {
  let remaining = frames;
  const attempt = () => {
    const row = findRow();
    if (row) {
      revealUserMessageFlash(row, reducedMotion);
      return;
    }
    if (--remaining > 0) requestFrame(attempt);
  };
  requestFrame(attempt);
}
