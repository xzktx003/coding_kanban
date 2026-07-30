const ANSI_ESCAPE_PATTERN =
  /\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B(?:[()][0-2A-Z]|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DEFAULT_MAX_LINES = 6;
const DEFAULT_MAX_LINE_LENGTH = 160;

export const EMPTY_TERMINAL_PREVIEW_TEXT = "暂无输出";
export const SUSPENDED_TERMINAL_PREVIEW_TEXT = "终端预览已暂停";

export function sanitizeTerminalPreviewText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHAR_PATTERN, "");
}

export function buildTerminalPreviewLines(
  text: string | null | undefined,
  options: {
    maxLines?: number;
    maxLineLength?: number;
    suspended?: boolean;
  } = {},
): string[] {
  if (options.suspended) {
    return [SUSPENDED_TERMINAL_PREVIEW_TEXT];
  }

  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES);
  const maxLineLength = Math.max(
    1,
    options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
  );
  const lines = sanitizeTerminalPreviewText(text ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line.length > maxLineLength
        ? `${line.slice(0, Math.max(0, maxLineLength - 1))}…`
        : line,
    );

  if (lines.length === 0) {
    return [EMPTY_TERMINAL_PREVIEW_TEXT];
  }

  return lines.slice(-maxLines);
}
