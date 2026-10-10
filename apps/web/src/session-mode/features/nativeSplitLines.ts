import type { DiffLine } from "./nativeDiffLines";
export type SplitDiffRow = {
  left?: number;
  right?: number;
  separator?: number;
};
export function nativeSplitLines(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].separator) {
      rows.push({ separator: i++ });
      continue;
    }
    if (lines[i].type === "normal") {
      rows.push({ left: i, right: i });
      i++;
      continue;
    }
    const removed: number[] = [],
      added: number[] = [];
    while (
      i < lines.length &&
      !lines[i].separator &&
      lines[i].type === "remove"
    )
      removed.push(i++);
    while (i < lines.length && !lines[i].separator && lines[i].type === "add")
      added.push(i++);
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++)
      rows.push({
        ...(removed[pair] !== undefined ? { left: removed[pair] } : {}),
        ...(added[pair] !== undefined ? { right: added[pair] } : {}),
      });
  }
  return rows;
}
