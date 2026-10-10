import type { CSSProperties } from "react";

/** Display-only normalization from the extension's shell block. Never execute this value. */
export function normalizeNativeCommand(command: string): string {
  const unwrap = (value: string) => {
    let result = value.trim();
    while (true) {
      if (result.startsWith("$'") && result.endsWith("'")) {
        result = result.slice(2, -1).replace(/\\'/g, "'");
      } else if (
        (result.startsWith("'") && result.endsWith("'")) ||
        (result.startsWith('"') && result.endsWith('"'))
      ) {
        const double = result.startsWith('"');
        result = result.slice(1, -1).replace(/'"'"'/g, "'");
        if (double) result = result.replace(/\\"/g, '"');
      } else return result;
    }
  };
  const clean = (value: string) => {
    let result = value.trim().replace(/^\$\s+/, "");
    if (result.startsWith("'") && result.endsWith("'\"'\"")) result += "''";
    result = result.replace(/'"'"'/g, "'");
    while (
      (result.startsWith("'") && result.endsWith("'")) ||
      (result.startsWith('"') && result.endsWith('"'))
    )
      result = result.slice(1, -1).trim();
    return result.trim();
  };
  const raw = unwrap(clean(command));
  const wrapped =
    raw.match(/^(?:\/bin\/zsh|\/bin\/bash|zsh|bash)\s+-lc\s+([\s\S]+)$/) ??
    command.match(/(?:\/bin\/zsh|\/bin\/bash|zsh|bash)\s+-lc\s+([\s\S]+)$/);
  return clean(wrapped ? unwrap(wrapped[1].trim()) : raw);
}

export function nativeShellName(command: string): string | null {
  const executable = command.trim().match(/^(?:["']([^"']+)["']|([^\s]+))/);
  const name = (executable?.[1] ?? executable?.[2] ?? "")
    .split(/[/\\]/)
    .at(-1)
    ?.toLowerCase();
  return [
    "bash",
    "zsh",
    "sh",
    "fish",
    "pwsh",
    "powershell",
    "cmd",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
  ].includes(name ?? "")
    ? name!.replace(/\.exe$/, "")
    : null;
}

export function commandDurationLabel(
  durationMs?: number | null,
): string | null {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  )
    return null;
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 1) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours >= 24 ? `${Math.floor(hours / 24)}d ` : ""}${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}

export type AnsiSegment = {
  text: string;
  className?: string;
  style?: CSSProperties;
};
const colors = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];
/** Native ANSI class names; rendered as React text, without HTML or actionable OSC links. */
export function ansiSegments(source: string): AnsiSegment[] {
  const input = source.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, "");
  let foreground: string | undefined, background: string | undefined;
  const decorations = new Set<number>();
  const rows: AnsiSegment[] = [];
  let line: AnsiSegment[] = [];
  let cursor = 0;
  const style = (): CSSProperties | undefined => {
    const result: CSSProperties = {};
    if (decorations.has(1)) result.fontWeight = "bold";
    if (decorations.has(2)) result.opacity = 0.5;
    if (decorations.has(3)) result.fontStyle = "italic";
    if (decorations.has(8)) result.visibility = "hidden";
    const lines = [
      decorations.has(4) && "underline",
      decorations.has(9) && "line-through",
    ].filter(Boolean);
    if (lines.length) result.textDecorationLine = lines.join(" ");
    return Object.keys(result).length ? result : undefined;
  };
  const append = (text: string) => {
    if (!text) return;
    const className =
      [foreground, background].filter(Boolean).join(" ") || undefined;
    const item: AnsiSegment = {
      text,
      ...(className ? { className } : {}),
      ...(style() ? { style: style() } : {}),
    };
    const previous = rows.at(-1);
    if (
      previous &&
      previous.className === item.className &&
      JSON.stringify(previous.style) === JSON.stringify(item.style)
    )
      previous.text += text;
    else rows.push(item);
  };
  const flush = () => {
    for (const cell of line) {
      const previous = rows.at(-1);
      if (
        previous &&
        previous.className === cell.className &&
        JSON.stringify(previous.style) === JSON.stringify(cell.style)
      )
        previous.text += cell.text;
      else rows.push({ ...cell });
    }
    line = [];
    cursor = 0;
  };
  // Ordinary logs avoid building one object per character. Progress output needs terminal overwrite semantics.
  const editing = /[\r\b]/.test(input);
  const write = (text: string) => {
    if (!editing) {
      append(text);
      return;
    }
    const className =
      [foreground, background].filter(Boolean).join(" ") || undefined;
    const currentStyle = style();
    for (const char of text) {
      if (char === "\n") {
        flush();
        append("\n");
      } else if (char === "\r") cursor = 0;
      else if (char === "\b") {
        if (cursor > 0) {
          cursor--;
          line.splice(cursor, 1);
        }
      } else line[cursor++] = { text: char, className, style: currentStyle };
    }
  };
  const controls =
    /\x1b\[([\d;]*)([ -/]*[@-~])|\x1b[^\[]|[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g;
  let offset = 0;
  for (const match of input.matchAll(controls)) {
    write(input.slice(offset, match.index));
    offset = match.index + match[0].length;
    if (
      match[2] === "K" &&
      editing &&
      cursor === 0 &&
      /^(?:0|2)?$/.test(match[1])
    )
      line = [];
    if (match[2] !== "m") continue;
    const codes = (match[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        foreground = background = undefined;
        decorations.clear();
      } else if ([1, 2, 3, 4, 8, 9].includes(code)) decorations.add(code);
      else if (code === 21 || code === 22) {
        decorations.delete(1);
        if (code === 22) decorations.delete(2);
      } else if (code === 23) decorations.delete(3);
      else if (code === 24) decorations.delete(4);
      else if (code === 28) decorations.delete(8);
      else if (code === 29) decorations.delete(9);
      else if (code === 39) foreground = undefined;
      else if (code === 49) background = undefined;
      else if (code >= 30 && code <= 37)
        foreground = `ansi-${colors[code - 30]}-fg`;
      else if (code >= 40 && code <= 47)
        background = `ansi-${colors[code - 40]}-bg`;
      else if (code >= 90 && code <= 97)
        foreground = `ansi-bright-${colors[code - 90]}-fg`;
      else if (code >= 100 && code <= 107)
        background = `ansi-bright-${colors[code - 100]}-bg`;
      else if (code === 38 || code === 48) {
        const mode = codes[++i];
        const extended = mode === 5 ? codes[++i] : undefined;
        const color =
          extended != null && extended >= 0 && extended <= 255
            ? `ansi-palette-${extended}`
            : mode === 2
              ? "ansi-truecolor"
              : undefined;
        if (mode === 2) i += 3;
        if (color) {
          if (code === 38) foreground = `${color}-fg`;
          else background = `${color}-bg`;
        }
      }
    }
  }
  write(input.slice(offset));
  if (editing) flush();
  return rows;
}
