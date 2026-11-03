export type MobileAccessoryKey =
  | "escape"
  | "tab"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "enter"
  | "ctrl-c"
  | "ctrl-d"
  | "backspace"
  | "shift-tab"
  | "shift-enter"
  | "ctrl-enter"
  | "ctrl-l"
  | "ctrl-z";

const ACCESSORY_INPUT: Record<MobileAccessoryKey, string> = {
  escape: "\x1b",
  tab: "\t",
  "arrow-up": "\x1b[A",
  "arrow-down": "\x1b[B",
  "arrow-left": "\x1b[D",
  "arrow-right": "\x1b[C",
  enter: "\r",
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
  backspace: "\x7f",
  "shift-tab": "\x1b[Z",
  "shift-enter": "\x1b[13;2u",
  "ctrl-enter": "\x1b[13;5u",
  "ctrl-l": "\x0c",
  "ctrl-z": "\x1a",
};

export const MOBILE_ACCESSORY_KEYS = Object.keys(
  ACCESSORY_INPUT,
) as MobileAccessoryKey[];

export function mobileAccessoryKeyInput(key: MobileAccessoryKey): string {
  return ACCESSORY_INPUT[key];
}

export type MobileImeEvent =
  | { type: "compositionupdate"; data: string }
  | { type: "compositionend"; data: string }
  | { type: "input"; data: string; composing: boolean };

/** Composition previews stay on the IME. Only a committed string is sent. */
export function mobileImeCommit(event: MobileImeEvent): string | null {
  if (event.type === "compositionupdate") {
    return null;
  }
  if (event.type === "compositionend") {
    return event.data.length > 0 ? event.data : null;
  }
  if (event.composing || event.data.length === 0) {
    return null;
  }
  return event.data;
}
