import type { EnterBehavior } from "@session/stores/useFollowupSettingsStore";
export function submitIntent(
  event: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
  text: string,
  behavior: EnterBehavior,
): "default" | "opposite" | null {
  // Some browser/IME combinations only mark the final composing Enter as 229.
  if (event.isComposing || event.keyCode === 229) return null;
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
