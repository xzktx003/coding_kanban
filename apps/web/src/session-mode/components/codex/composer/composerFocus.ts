/**
 * Switching a session should not open the soft keyboard on touch devices.
 * Users can still focus the composer explicitly by tapping it.
 */
export function shouldAutoFocusComposer(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia?.("(pointer: coarse)").matches;
}
