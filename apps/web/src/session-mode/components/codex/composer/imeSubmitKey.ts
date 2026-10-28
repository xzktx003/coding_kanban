/**
 * Enter both accepts an input-method candidate and submits a form. Acting on the
 * composing Enter would send half-typed text, so submission waits for the
 * composition to end. The official composer guards the same two signals.
 */
export interface EnterSubmitKey {
  key: string;
  isComposing: boolean;
  /** Some input methods report the composition Enter only as keyCode 229. */
  keyCode?: number;
  /** Shift+Enter continues the line instead of sending. */
  shiftKey?: boolean;
}

export function shouldSubmitOnEnter({
  key,
  isComposing,
  keyCode,
  shiftKey,
}: EnterSubmitKey) {
  if (key !== "Enter" || shiftKey) return false;
  return !isComposing && keyCode !== 229;
}
