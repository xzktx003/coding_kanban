import MarkdownIt from "markdown-it";
export interface VisualizationReference {
  path: string;
  mode?: "wide";
  title?: string;
}
export type VisualizationPart =
  | { kind: "markdown"; text: string }
  | { kind: "visualization"; reference: VisualizationReference }
  | { kind: "pending" };
const start = "visualize",
  end = "";
const markdown = new MarkdownIt({ html: true });
function protectedRanges(text: string): Array<[number, number]> {
  const lines = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lines.push(i + 1);
  const ranges: Array<[number, number]> = [];
  for (const token of markdown.parse(text, {}))
    if (token.map && ["fence", "code_block", "html_block"].includes(token.type))
      ranges.push([lines[token.map[0]], lines[token.map[1]] ?? text.length]);
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`" || ranges.some(([a, b]) => i >= a && i < b)) {
      i++;
      continue;
    }
    let n = 1;
    while (text[i + n] === "`") n++;
    let j = i + n,
      close = -1;
    while (j < text.length) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let k = 1;
      while (text[j + k] === "`") k++;
      if (k === n) {
        close = j + k;
        break;
      }
      j += k;
    }
    if (close >= 0) {
      ranges.push([i, close]);
      i = close;
    } else i += n;
  }
  return ranges;
}
function reference(raw: string): VisualizationReference | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.path !== "string" ||
      !value.path.startsWith("/") ||
      value.path.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(value.path) ||
      value.path.split("/").includes("..") ||
      !/[.]html?$/i.test(value.path)
    )
      return null;
    if (value.mode !== undefined && value.mode !== "wide") return null;
    if (
      value.title !== undefined &&
      (typeof value.title !== "string" || value.title.length > 200)
    )
      return null;
    return {
      path: value.path,
      ...(value.mode === "wide" ? { mode: "wide" as const } : {}),
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    };
  } catch {
    return null;
  }
}
export function splitVisualizationContent(text: string): VisualizationPart[] {
  if (!text.includes(start)) return [{ kind: "markdown", text }];
  const protectedSpans = protectedRanges(text),
    parts: VisualizationPart[] = [];
  let cursor = 0,
    search = 0;
  while (search < text.length) {
    const at = text.indexOf(start, search);
    if (at < 0) break;
    if (protectedSpans.some(([a, b]) => at >= a && at < b)) {
      search = at + start.length;
      continue;
    }
    const close = text.indexOf(end, at + start.length);
    if (close < 0) {
      if (at > cursor)
        parts.push({ kind: "markdown", text: text.slice(cursor, at) });
      parts.push({ kind: "pending" });
      cursor = text.length;
      break;
    }
    const spec = reference(text.slice(at + start.length, close));
    search = close + end.length;
    if (!spec) continue;
    if (at > cursor)
      parts.push({ kind: "markdown", text: text.slice(cursor, at) });
    parts.push({ kind: "visualization", reference: spec });
    cursor = search;
  }
  if (cursor < text.length)
    parts.push({ kind: "markdown", text: text.slice(cursor) });
  return parts.length ? parts : [{ kind: "markdown", text }];
}
