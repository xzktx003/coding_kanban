import type { BrowserDictationPhase } from "@session/BrowserDictationButton";
export type ComposerPrimaryAction =
  | "dictation-finish"
  | "dictation-wait"
  | "voice-send"
  | "voice-end"
  | "voice-wait"
  | "stop"
  | "resume"
  | "send"
  | "queue"
  | "steer";
export function hasPendingComposerInput(
  items: readonly { status: string }[],
): boolean {
  return items.some((item) =>
    ["queued", "sending", "uncertain", "failed"].includes(item.status),
  );
}
/** One primary action, derived independently of visual rail/banner layout. */
export function composerPrimaryAction(state: {
  dictation: BrowserDictationPhase;
  realtime?: "idle" | "starting" | "active" | "stopping" | "failed";
  running: boolean;
  hasContent: boolean;
  resumeAvailable: boolean;
  mode: "queue" | "steer";
}): ComposerPrimaryAction {
  if (state.dictation === "recording") return "dictation-finish";
  if (state.dictation === "starting" || state.dictation === "transcribing")
    return "dictation-wait";
  if (state.realtime === "starting" || state.realtime === "stopping") return "voice-wait";
  if (state.realtime === "active") return state.hasContent ? "voice-send" : "voice-end";
  if (state.running && !state.hasContent) return "stop";
  if (!state.running && !state.hasContent && state.resumeAvailable)
    return "resume";
  return state.running ? state.mode : "send";
}
