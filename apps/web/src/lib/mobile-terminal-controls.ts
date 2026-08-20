export type MobileTerminalControlId =
  | "interrupt"
  | "escape"
  | "backspace"
  | "tab"
  | "shift-tab"
  | "enter"
  | "shift-enter"
  | "ctrl-enter"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "ctrl-l"
  | "ctrl-z";

export interface MobileTerminalControl {
  id: MobileTerminalControlId;
  label: string;
  input: string;
  description: string;
  danger?: boolean;
}

export const MOBILE_TERMINAL_CONTROLS: MobileTerminalControl[] = [
  {
    id: "escape",
    label: "ESC",
    input: "\x1b",
    description: "退出 TUI 当前状态",
  },
  {
    id: "interrupt",
    label: "Ctrl+C",
    input: "\x03",
    description: "中断当前输出或命令",
    danger: true,
  },
  {
    id: "arrow-left",
    label: "←",
    input: "\x1b[D",
    description: "方向键左",
  },
  {
    id: "arrow-up",
    label: "↑",
    input: "\x1b[A",
    description: "方向键上",
  },
  {
    id: "arrow-down",
    label: "↓",
    input: "\x1b[B",
    description: "方向键下",
  },
  {
    id: "arrow-right",
    label: "→",
    input: "\x1b[C",
    description: "方向键右",
  },
  {
    id: "backspace",
    label: "⌫",
    input: "\x7f",
    description: "退格，删除光标前字符",
  },
  {
    id: "tab",
    label: "Tab",
    input: "\t",
    description: "补全或切换焦点",
  },
  {
    id: "enter",
    label: "Enter",
    input: "\r",
    description: "提交当前输入",
  },
  {
    id: "shift-tab",
    label: "⇧Tab",
    input: "\x1b[Z",
    description: "反向切换 TUI 焦点，适用于 Claude / Copilot 表单导航",
  },
  {
    id: "shift-enter",
    label: "⇧Enter",
    input: "\x1b[13;2u",
    description: "插入换行（不提交）",
  },
  {
    id: "ctrl-enter",
    label: "Ctrl+Enter",
    input: "\x1b[13;5u",
    description: "强制提交（TUI 多行编辑模式下）",
  },
  {
    id: "ctrl-l",
    label: "Ctrl+L",
    input: "\x0c",
    description: "清屏",
  },
  {
    id: "ctrl-z",
    label: "Ctrl+Z",
    input: "\x1a",
    description: "挂起进程",
  },
];

export type MobileTerminalToolbarItem =
  | MobileTerminalControlId
  | "shift"
  | "help";

export const MOBILE_TERMINAL_TOOLBAR_ORDER: MobileTerminalToolbarItem[] = [
  "shift",
  "escape",
  "interrupt",
  "enter",
  "tab",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "arrow-right",
  "backspace",
  "shift-tab",
  "shift-enter",
  "ctrl-enter",
  "ctrl-l",
  "ctrl-z",
  "help",
];

const REPEATABLE_MOBILE_TERMINAL_CONTROLS = new Set<MobileTerminalControlId>([
  "backspace",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
]);

export function isMobileTerminalControlRepeatable(
  id: MobileTerminalControlId,
): boolean {
  return REPEATABLE_MOBILE_TERMINAL_CONTROLS.has(id);
}

interface MobilePressRepeatScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface MobilePressRepeaterOptions {
  delayMs?: number;
  intervalMs?: number;
  scheduler?: MobilePressRepeatScheduler;
  startDelayMs?: number;
}

export interface MobilePressRepeater {
  start(): void;
  stop(): void;
}

export const MOBILE_TERMINAL_HOLD_REPEAT_DELAY_MS = 3000;
export const MOBILE_TERMINAL_HOLD_MOVEMENT_SLOP_PX = 10;

export function exceedsMobileTerminalHoldMovement(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  slopPx = MOBILE_TERMINAL_HOLD_MOVEMENT_SLOP_PX,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > slopPx;
}

const defaultRepeatScheduler: MobilePressRepeatScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createMobilePressRepeater(
  action: () => Promise<void> | void,
  options: MobilePressRepeaterOptions = {},
): MobilePressRepeater {
  const delayMs = options.delayMs ?? 360;
  const intervalMs = options.intervalMs ?? 85;
  const startDelayMs = options.startDelayMs ?? 0;
  const scheduler = options.scheduler ?? defaultRepeatScheduler;
  let active = false;
  let generation = 0;
  let timer: unknown;

  const run = async (currentGeneration: number, first: boolean) => {
    try {
      await action();
    } catch {
      active = false;
      return;
    }
    if (!active || generation !== currentGeneration) return;
    timer = scheduler.setTimeout(
      () => void run(currentGeneration, false),
      first ? delayMs : intervalMs,
    );
  };

  return {
    start() {
      if (active) return;
      active = true;
      generation += 1;
      const currentGeneration = generation;
      if (startDelayMs > 0) {
        timer = scheduler.setTimeout(
          () => void run(currentGeneration, true),
          startDelayMs,
        );
        return;
      }
      void run(currentGeneration, true);
    },
    stop() {
      active = false;
      generation += 1;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      timer = undefined;
    },
  };
}

const SHIFTED_MOBILE_TERMINAL_INPUTS: Partial<
  Record<MobileTerminalControlId, string>
> = {
  tab: "\x1b[Z",
  enter: "\x1b[13;2u",
  "arrow-up": "\x1b[1;2A",
  "arrow-down": "\x1b[1;2B",
  "arrow-left": "\x1b[1;2D",
  "arrow-right": "\x1b[1;2C",
};

export type MobileComposerSendMode = "send" | "paste";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

function normalizeComposerText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function buildMobileComposerInput(
  text: string,
  mode: MobileComposerSendMode,
): string {
  return buildMobileComposerInputFrames(text, mode).join("");
}

export function buildMobileComposerInputFrames(
  text: string,
  mode: MobileComposerSendMode,
): string[] {
  const normalized = normalizeComposerText(text);

  const pastedPrompt =
    mode === "send" ? normalized.replace(/\n+$/g, "") : normalized;
  const pasteFrame = `${BRACKETED_PASTE_START}${pastedPrompt}${BRACKETED_PASTE_END}`;
  return mode === "paste" ? [pasteFrame] : [pasteFrame, "\r"];
}

export type MobileComposerSendResult =
  | { ok: true }
  | { ok: false; error: unknown; nextFrameIndex: number };

export async function sendMobileComposerFrames(
  frames: string[],
  onSendInput: (input: string) => Promise<void> | void,
  startFrameIndex = 0,
): Promise<MobileComposerSendResult> {
  for (let index = startFrameIndex; index < frames.length; index += 1) {
    try {
      await onSendInput(frames[index]!);
    } catch (error) {
      return { ok: false, error, nextFrameIndex: index };
    }
  }
  return { ok: true };
}

export function getMobileTerminalControlInput(
  id: MobileTerminalControlId,
  shifted = false,
): string {
  const control = MOBILE_TERMINAL_CONTROLS.find((item) => item.id === id);
  if (!control) {
    throw new Error(`Unknown mobile terminal control: ${id}`);
  }
  return shifted
    ? (SHIFTED_MOBILE_TERMINAL_INPUTS[id] ?? control.input)
    : control.input;
}
