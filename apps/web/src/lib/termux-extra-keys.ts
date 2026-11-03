export const TERMUX_EXTRA_KEY_ROWS = [
  ["ESC", "/", "-", "HOME", "UP", "END", "PGUP"],
  ["TAB", "CTRL", "ALT", "LEFT", "DOWN", "RIGHT", "PGDN"],
] as const;

export type TermuxExtraKey = (typeof TERMUX_EXTRA_KEY_ROWS)[number][number];

const KEY_BYTES: Record<Exclude<TermuxExtraKey, "CTRL" | "ALT">, string> = {
  ESC: "\x1b",
  "/": "/",
  "-": "-",
  HOME: "\x1b[H",
  UP: "\x1b[A",
  END: "\x1b[F",
  PGUP: "\x1b[5~",
  TAB: "\t",
  LEFT: "\x1b[D",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  PGDN: "\x1b[6~",
};

export interface TermuxModifierState {
  ctrl: boolean;
  alt: boolean;
}

export function applyTermuxExtraKey(
  key: TermuxExtraKey,
  modifiers: TermuxModifierState,
): { bytes: string | null; modifiers: TermuxModifierState } {
  if (key === "CTRL") {
    return { bytes: null, modifiers: { ...modifiers, ctrl: !modifiers.ctrl } };
  }
  if (key === "ALT") {
    return { bytes: null, modifiers: { ...modifiers, alt: !modifiers.alt } };
  }

  let bytes = KEY_BYTES[key];
  if (modifiers.alt && key !== "ESC") {
    bytes = `\x1b${bytes}`;
  }
  if (modifiers.ctrl) {
    const ctrlBytes: Partial<Record<TermuxExtraKey, string>> = {
      TAB: "\x00",
      "/": "\x1f",
      "-": "\x1f",
      ESC: "\x1b",
      LEFT: "\x1b[1;5D",
      RIGHT: "\x1b[1;5C",
      UP: "\x1b[1;5A",
      DOWN: "\x1b[1;5B",
      HOME: "\x1b[1;5H",
      END: "\x1b[1;5F",
      PGUP: "\x1b[5;5~",
      PGDN: "\x1b[6;5~",
    };
    if (ctrlBytes[key]) bytes = ctrlBytes[key]!;
  }
  return { bytes, modifiers: { ctrl: false, alt: false } };
}

export type TermuxFingerAction =
  | { type: "tap" }
  | { type: "wheel"; rows: number }
  | { type: "arrows"; rows: number }
  | { type: "local-scroll"; rows: number }
  | { type: "none" };

export function classifyTermuxFinger({
  moved,
  deltaY,
  lineHeight,
  longPress,
  mouseTracking,
  alternateScreen,
}: {
  moved: number;
  deltaY: number;
  lineHeight: number;
  longPress: boolean;
  mouseTracking: boolean;
  alternateScreen: boolean;
}): TermuxFingerAction {
  if (longPress && moved < 12) return { type: "none" };
  if (Math.abs(moved) < 12 && !longPress) return { type: "tap" };
  const rows = Math.trunc(deltaY / Math.max(1, lineHeight));
  if (rows === 0) return { type: "none" };
  if (mouseTracking) return { type: "wheel", rows };
  if (alternateScreen) return { type: "arrows", rows };
  return { type: "local-scroll", rows };
}

type PointerTarget = {
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options: { capture: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options: { capture: boolean },
  ): void;
};

/** Installs the phone pointer handlers and returns the matching removal. */
export function listenTermuxPointer(
  target: PointerTarget,
  listener: {
    down: (event: Event) => void;
    move: (event: Event) => void;
    up: (event: Event) => void;
  },
): () => void {
  const capture = { capture: true };
  target.addEventListener("pointerdown", listener.down, capture);
  target.addEventListener("pointermove", listener.move, capture);
  target.addEventListener("pointerup", listener.up, capture);
  return () => {
    target.removeEventListener("pointerdown", listener.down, capture);
    target.removeEventListener("pointermove", listener.move, capture);
    target.removeEventListener("pointerup", listener.up, capture);
  };
}

/** Extra rows to emit after the finger lifts. Termux scales fling velocity by 0.25. */
export function termuxFlingRows(
  velocityYpxPerMs: number,
  lineHeight: number,
  maxRows: number,
): number {
  if (!Number.isFinite(velocityYpxPerMs) || Math.abs(velocityYpxPerMs) < 0.3) {
    return 0;
  }
  const pixels = velocityYpxPerMs * 180 * 0.25;
  const rows = Math.trunc(pixels / Math.max(1, lineHeight));
  const cap = Math.max(1, Math.floor(Math.max(1, maxRows) / 2));
  return Math.max(-cap, Math.min(cap, rows));
}
