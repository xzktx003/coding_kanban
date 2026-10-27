import type { NativeContentState } from "./native-content";

/** Render the exact conversation, or native onboarding with no input composer. */
export function isNativeWindowReady(
  id: string,
  state: NativeContentState,
): boolean {
  return (
    state.ready &&
    !state.startupError &&
    (id.startsWith("new:") ||
      state.conversationId === id ||
      (state.onboarding === true &&
        !state.hasComposer &&
        !state.conversationId))
  );
}
