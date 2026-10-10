import { diffLines } from "diff";
export type DiffLine = {
  type: "add" | "remove" | "normal";
  content: string;
  lineNumber: { old?: number; new?: number };
  separator?: boolean;
};

/** Parse native hunk positions; a saved patch is not a pair of files starting at line one. */
export function nativeDiffLines(
  original: string,
  current: string,
  unified?: string,
): DiffLine[] {
  if (unified && /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(unified)) {
    const result: DiffLine[] = [];
    let old = 0,
      next = 0,
      inHunk = false;
    for (const line of unified.split("\n")) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        old = Number(hunk[1]);
        next = Number(hunk[2]);
        inHunk = true;
        result.push({
          type: "normal",
          content: line,
          lineNumber: {},
          separator: true,
        });
      } else if (line.startsWith("diff --git ")) inHunk = false;
      else if (inHunk && line.startsWith("-"))
        result.push({
          type: "remove",
          content: line.slice(1),
          lineNumber: { old: old++ },
        });
      else if (inHunk && line.startsWith("+"))
        result.push({
          type: "add",
          content: line.slice(1),
          lineNumber: { new: next++ },
        });
      else if (inHunk && line.startsWith(" "))
        result.push({
          type: "normal",
          content: line.slice(1),
          lineNumber: { old: old++, new: next++ },
        });
    }
    return result;
  }
  const result: DiffLine[] = [];
  let old = 0,
    next = 0;
  for (const change of diffLines(original, current)) {
    const lines = change.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const content of lines)
      result.push({
        type: change.added ? "add" : change.removed ? "remove" : "normal",
        content,
        lineNumber: {
          ...(!change.added ? { old: ++old } : {}),
          ...(!change.removed ? { new: ++next } : {}),
        },
      });
  }
  return result;
}
