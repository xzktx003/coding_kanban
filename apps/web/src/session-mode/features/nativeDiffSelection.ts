import type { DiffLine } from "./nativeDiffLines";

export interface NativeDiffSelection {
  side: "old" | "new";
  start: number;
  end: number;
  content: string;
}
export function selectNativeDiffRange(
  lines: DiffLine[], side: "old" | "new", from: number, to: number,
): NativeDiffSelection | null {
  if (![from, to].every((line) => Number.isSafeInteger(line) && line > 0)) return null;
  const start = Math.min(from, to), end = Math.max(from, to);
  const selected = lines.filter((line) => {
    const number = line.lineNumber[side];
    return !line.separator && number !== undefined && number >= start && number <= end;
  });
  // Missing saved context cannot silently become a continuous range.
  if (selected.length !== end - start + 1) return null;
  return { side, start, end, content: selected.map((line) => line.content).join("\n") };
}
