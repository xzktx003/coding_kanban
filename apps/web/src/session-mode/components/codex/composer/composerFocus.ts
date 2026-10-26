/**
 * Switching a session should not open the soft keyboard on touch devices.
 * Users can still focus the composer explicitly by tapping it.
 */
export function shouldAutoFocusComposer(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia?.("(pointer: coarse)").matches;
}

export function scheduleComposerAutoFocus(
  resolveRoot: () => HTMLElement | null,
  focus: () => void,
): () => void {
  const root = resolveRoot();
  if (!root || !shouldAutoFocusComposer()) return () => {};
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  const initialActive = document.activeElement;
  let cancelled = false;
  // Parent and editor can both request focus during mount. Let layout and
  // StrictMode cleanup finish before rebuilding a native contenteditable selection.
  const frame = view.requestAnimationFrame(() => {
    if (
      cancelled ||
      resolveRoot() !== root ||
      !root.isConnected ||
      !shouldAutoFocusComposer()
    )
      return;
    const active = document.activeElement;
    if (root.contains(active)) return;
    // A later deliberate focus belongs to the user, not this old mount request.
    if (active !== initialActive && active !== document.body) return;
    if (!root.getClientRects().length) return;
    focus();
  });
  return () => {
    cancelled = true;
    view.cancelAnimationFrame(frame);
  };
}
