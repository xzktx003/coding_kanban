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
    id: "interrupt",
    label: "Ctrl+C",
    input: "\x03",
    description: "中断当前输出或命令",
    danger: true,
  },
  {
    id: "escape",
    label: "ESC",
    input: "\x1b",
    description: "退出 TUI 当前状态",
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
    id: "shift-tab",
    label: "⇧Tab",
    input: "\x1b[Z",
    description: "反向切换 TUI 焦点，适用于 Claude / Copilot 表单导航",
  },
  {
    id: "enter",
    label: "Enter",
    input: "\r",
    description: "提交当前输入",
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
    id: "arrow-left",
    label: "←",
    input: "\x1b[D",
    description: "方向键左",
  },
  {
    id: "arrow-right",
    label: "→",
    input: "\x1b[C",
    description: "方向键右",
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

export type MobileComposerSendMode = "send" | "paste" | "paste-run";

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

  if (mode === "paste") {
    return [normalized];
  }

  const pastedPrompt = normalized.replace(/\n+$/g, "");
  return [
    `${BRACKETED_PASTE_START}${pastedPrompt}${BRACKETED_PASTE_END}`,
    "\r",
  ];
}

export function getMobileTerminalControlInput(
  id: MobileTerminalControlId,
): string {
  const control = MOBILE_TERMINAL_CONTROLS.find((item) => item.id === id);
  if (!control) {
    throw new Error(`Unknown mobile terminal control: ${id}`);
  }
  return control.input;
}
