import type { EnterBehavior } from "@session/stores/useFollowupSettingsStore";
export function submitIntent(
  event: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing?: boolean;
  },
  text: string,
  behavior: EnterBehavior,
): "default" | "opposite" | null {
  if (event.isComposing) return null;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.shiftKey) return "opposite";
  if (event.shiftKey) return null;
  if (
    !modifier &&
    (behavior === "cmdAlways" ||
      (behavior === "cmdIfMultiline" && text.includes("\n")))
  )
    return null;
  return "default";
}
