import { resolveLiteralFilePath } from "@session/components/codex/presentation/fileReference";
export interface NativeReviewFinding {
  id: string;
  title: string;
  body: string;
  path: string;
  start: number;
  end: number;
  side: "new";
  priority?: number;
}
const identity = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `finding-${(hash >>> 0).toString(16)}`;
};
function attributes(value: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const expression = /([a-zA-Z][\w-]*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s}]+)/gy;
  let offset = 0;
  while (offset < value.length) {
    while (/\s/.test(value[offset] ?? "") && offset < value.length) offset++;
    if (offset === value.length) break;
    expression.lastIndex = offset;
    const match = expression.exec(value);
    if (!match || ["__proto__", "constructor", "prototype"].includes(match[1]) || Object.hasOwn(result, match[1])) return null;
    let text = match[2];
    if (text.startsWith('"')) {
      try { text = JSON.parse(text); } catch { return null; }
    } else if (text.startsWith("'")) text = text.slice(1, -1).replace(/\\(['\\])/g, "$1");
    result[match[1]] = text;
    offset = expression.lastIndex;
  }
  return result;
}
/** The VSIX emits normal Markdown and line-start code-comment directives. Never
 * interpret a code example or malformed directive as a hidden annotation. */
export function parseNativeReviewFindings(text: string, cwd?: string | null): {
  markdown: string; findings: NativeReviewFinding[];
} {
  if (!text.includes("::code-comment")) return { markdown: text, findings: [] };
  const findings = new Map<string, NativeReviewFinding>(), output: string[] = [];
  let fence: { marker: string; count: number } | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], count: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.count && /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(line)) fence = null;
      output.push(line); continue;
    }
    const match = !fence && line.match(/^ {0,3}::code-comment\{([^\n]*)\}\s*$/);
    const attrs = match ? attributes(match[1]) : null;
    const path = attrs?.file ? resolveLiteralFilePath(attrs.file, cwd) : null;
    const number = (value?: string) => value === undefined ? undefined : /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
    const from = number(attrs?.start), to = number(attrs?.end), priority = number(attrs?.priority);
    if (!attrs?.title?.trim() || !attrs.body?.trim() || !path || [from, to, priority].some((n) => n !== undefined && !Number.isFinite(n))) { output.push(line); continue; }
    const start = Math.max(1, from ?? 1), end = Math.max(start, to ?? start);
    const title = priority !== undefined && !/^\[P\d+\]/i.test(attrs.title.trim()) ? `[P${priority}] ${attrs.title.trim()}` : attrs.title.trim();
    const finding = { title, body: attrs.body.trim(), path, start, end, side: "new" as const, ...(priority !== undefined ? { priority } : {}) };
    const id = identity(JSON.stringify(finding));
    findings.set(id, { id, ...finding });
  }
  return { markdown: output.join(""), findings: [...findings.values()] };
}
