/** Local Agent-message file directives from the native VSIX Wln/Rfi pipeline.
 * Opaque ChatGPT source IDs require separate message metadata and stay text.
 */
export type NativeFileCitation = {
  kind: "file" | "external";
  path: string;
  label?: string;
  purpose?: string;
  lineStart?: number;
  lineEnd?: number;
};
export type CitationSourceRange = { start: number; end: number };
export type NativeFileCitationMatch = {
  sourceStart: number;
  sourceEnd: number;
  matchedText: string;
  citation: NativeFileCitation;
};

const controlCharacters = /[\u0000-\u001f\u007f]/;
function text(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.trim() &&
    !controlCharacters.test(value)
    ? value.trim()
    : undefined;
}
function positiveLine(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return;
  if (typeof value === "string" && !/^\d+$/.test(value)) return;
  const line = Number(value);
  return Number.isSafeInteger(line) && line > 0 ? line : undefined;
}

export function parseNativeFileCitationAttributes(
  attributes: unknown,
): NativeFileCitation | null {
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  )
    return null;
  const attrs = attributes as Record<string, unknown>;
  const path = text(attrs.path);
  // Live artifact-session identifiers are not filesystem paths. Their native
  // opener is a separate host capability, so retain them in the source text.
  if (!path || attrs.mode != null) return null;
  let kind: NativeFileCitation["kind"] = "file";
  if (/^https?:/i.test(path)) {
    try {
      const url = new URL(path);
      if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
    } catch {
      return null;
    }
    kind = "external";
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
    return null;
  const label = text(attrs.label) ?? text(attrs.title);
  const purpose = text(attrs.purpose);
  const rawStart = attrs.lineRangeStart ?? attrs.line_range_start;
  const rawEnd = attrs.lineRangeEnd ?? attrs.line_range_end;
  const lineStart = positiveLine(rawStart);
  const lineEnd = positiveLine(rawEnd);
  // Native ignores some malformed coordinates. Keep those directives literal
  // rather than present an active range that silently becomes line one.
  if (
    (rawStart !== undefined && lineStart === undefined) ||
    (rawEnd !== undefined &&
      (lineEnd === undefined || lineStart === undefined)) ||
    (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart)
  )
    return null;
  return {
    kind,
    path,
    ...(label ? { label } : {}),
    ...(purpose ? { purpose } : {}),
    ...(lineStart ? { lineStart } : {}),
    ...(lineEnd ? { lineEnd } : {}),
  };
}

export function decodeNativeFileCitation(
  value: unknown,
): NativeFileCitation | null {
  if (typeof value !== "string") return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object") return null;
    const attrs = data as Record<string, unknown>;
    const citation = parseNativeFileCitationAttributes({
      ...attrs,
      lineRangeStart: attrs.lineStart,
      lineRangeEnd: attrs.lineEnd,
    });
    return citation && citation.kind === attrs.kind ? citation : null;
  } catch {
    return null;
  }
}

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && source[at] === "\\"; at--) slashes++;
  return slashes % 2 === 1;
}
function readAttributes(
  source: string,
  start: number,
): { end: number; attrs: Record<string, unknown> } | null {
  const attrs: Record<string, unknown> = Object.create(null);
  let at = start;
  while (at < source.length) {
    while (source[at] === " " || source[at] === "\t") at++;
    if (source[at] === "}") return { end: at + 1, attrs };
    const name = /^[\w-]+/.exec(source.slice(at))?.[0];
    if (!name) return null;
    at += name.length;
    while (source[at] === " " || source[at] === "\t") at++;
    if (source[at] !== "=") {
      attrs[name] = true;
      continue;
    }
    at++;
    while (source[at] === " " || source[at] === "\t") at++;
    const quote = source[at];
    let value = "";
    if (quote === "'" || quote === '"') {
      at++;
      let closed = false;
      while (at < source.length && !/[\r\n]/.test(source[at])) {
        if (source[at] === quote) {
          at++;
          closed = true;
          break;
        }
        if (source[at] === "\\" && source[at + 1] === quote) {
          value += quote;
          at += 2;
        } else value += source[at++];
      }
      if (!closed) return null;
    } else {
      const unquoted = /^[^\s}]+/.exec(source.slice(at))?.[0];
      if (!unquoted) return null;
      value = unquoted;
      at += value.length;
    }
    attrs[name] = value;
    if (source[at] !== "}" && source[at] !== " " && source[at] !== "\t")
      return null;
  }
  return null;
}

export function parseNativeFileCitations(
  source: string,
  excludedRanges: readonly CitationSourceRange[] = [],
): NativeFileCitationMatch[] {
  const matches: NativeFileCitationMatch[] = [];
  const starts =
    /:{1,3}codex-file-citation(?:\[[^\]\r\n]*\])?\{|【[^\r\n】]*†L\d+(?:-L\d+)?】/g;
  for (const candidate of source.matchAll(starts)) {
    const start = candidate.index;
    if (escapedAt(source, start) || source[start - 1] === ":") continue;
    let end: number;
    let citation: NativeFileCitation | null;
    if (candidate[0].startsWith("【")) {
      const legacy = /^【(.*?)†L(\d+)(?:-L(\d+))?】$/.exec(candidate[0]);
      if (!legacy) continue;
      let path = legacy[1].trim();
      if (path.startsWith("F:")) {
        try {
          path = decodeURI(path.slice(2).trim());
        } catch {
          continue;
        }
      } else if (!/^(?:[\\/]|[a-z]:[\\/])/i.test(path)) continue;
      const lineStart = positiveLine(legacy[2]);
      const lineEnd = positiveLine(legacy[3]);
      if (!lineStart || (legacy[3] && !lineEnd)) continue;
      citation = parseNativeFileCitationAttributes({
        path,
        lineRangeStart: lineStart,
        lineRangeEnd: lineEnd,
      });
      end = start + candidate[0].length;
    } else {
      const result = readAttributes(source, start + candidate[0].length);
      if (!result) continue;
      citation = parseNativeFileCitationAttributes(result.attrs);
      end = result.end;
    }
    if (
      !citation ||
      excludedRanges.some((range) => start < range.end && end > range.start)
    )
      continue;
    if (matches.at(-1)?.sourceEnd && start < matches.at(-1)!.sourceEnd)
      continue;
    matches.push({
      sourceStart: start,
      sourceEnd: end,
      matchedText: source.slice(start, end),
      citation,
    });
  }
  return matches;
}

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName: string; hProperties: Record<string, string> };
};
const excludedNodes = new Set([
  "code",
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "definition",
  "link",
  "linkReference",
]);
// Positions refer to raw Markdown, while mdast text has already unescaped ASCII
// punctuation. Decode only text; never render attribute strings as HTML.
function unescapeText(value: string): string {
  return value
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .replace(
      /&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|lt|gt);/gi,
      (whole, decimal: string, hex: string) => {
        if (decimal || hex) {
          const point = Number.parseInt(decimal ?? hex, hex ? 16 : 10);
          return point > 0 &&
            point <= 0x10ffff &&
            !(point >= 0xd800 && point <= 0xdfff)
            ? String.fromCodePoint(point)
            : whole;
        }
        return (
          (
            {
              "&amp;": "&",
              "&quot;": '"',
              "&apos;": "'",
              "&lt;": "<",
              "&gt;": ">",
            } as Record<string, string>
          )[whole.toLowerCase()] ?? whole
        );
      },
    );
}

/** Capturing the displayed source avoids interpreting escaped literals after
 * mdast has decoded them. The custom node has no URL or executable HTML.
 */
export function remarkNativeFileCitations(source: string) {
  return () => (tree: MarkdownNode, file?: { value?: unknown }) => {
    // Streamdown parses individual blocks with positions relative to each
    // block's VFile. Use that source instead of the whole message when present.
    const displayedSource =
      typeof file?.value === "string" ? file.value : source;
    const offsets = (node: MarkdownNode) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      return start == null || end == null ? null : { start, end };
    };
    const isBareAutolink = (node: MarkdownNode) => {
      const range = offsets(node);
      // GFM literal autolinks have no '[' or '<' delimiters in their source.
      // Explicit Markdown links and angle autolinks remain excluded containers.
      return (
        node.type === "link" &&
        range != null &&
        /^https?:\/\//i.test(displayedSource.slice(range.start, range.end))
      );
    };
    const transform = (group: MarkdownNode[]): MarkdownNode[] => {
      const first = offsets(group[0]);
      const last = offsets(group.at(-1)!);
      if (!first || !last) return group;
      const matches = parseNativeFileCitations(
        displayedSource.slice(first.start, last.end),
      )
        .map((match) => ({
          ...match,
          sourceStart: match.sourceStart + first.start,
          sourceEnd: match.sourceEnd + first.start,
        }))
        // A directive must begin in text. A token occurring inside an ordinary
        // bare URL is part of that URL, not a new file-navigation capability.
        .filter((match) =>
          group.some((node) => {
            const range = offsets(node);
            return (
              node.type === "text" &&
              range != null &&
              match.sourceStart >= range.start &&
              match.sourceStart < range.end
            );
          }),
        );
      if (!matches.length) return group;
      const slice = (start: number, end: number): MarkdownNode[] | null => {
        const result: MarkdownNode[] = [];
        for (const node of group) {
          const range = offsets(node)!;
          const left = Math.max(start, range.start),
            right = Math.min(end, range.end);
          if (left >= right) continue;
          if (left === range.start && right === range.end) {
            result.push(node);
            continue;
          }
          const raw = displayedSource.slice(range.start, range.end);
          if (node.type === "text" && node.value != null) {
            const prefix = unescapeText(raw.slice(0, left - range.start));
            const through = unescapeText(raw.slice(0, right - range.start));
            // Unknown parser normalization keeps the source visible instead
            // of dropping text or creating a misaligned citation action.
            if (
              !node.value.startsWith(prefix) ||
              !node.value.startsWith(through)
            )
              return null;
            result.push({
              type: "text",
              value: node.value.slice(prefix.length, through.length),
            });
          } else {
            // GFM can absorb a directive's closing quote/brace into a literal
            // URL. Any remaining suffix is ordinary text, not a forged href.
            result.push({
              type: "text",
              value: unescapeText(displayedSource.slice(left, right)),
            });
          }
        }
        return result;
      };
      const result: MarkdownNode[] = [];
      let cursor = first.start;
      for (const match of matches) {
        const before = slice(cursor, match.sourceStart);
        if (!before) return group;
        result.push(...before, {
          type: "nativeFileCitation",
          data: {
            hName: "span",
            hProperties: {
              "data-native-file-citation": JSON.stringify(match.citation),
            },
          },
          children: [],
        });
        cursor = match.sourceEnd;
      }
      const after = slice(cursor, last.end);
      return after ? [...result, ...after] : group;
    };
    const visit = (node: MarkdownNode) => {
      if (excludedNodes.has(node.type) || !node.children) return;
      const result: MarkdownNode[] = [];
      let group: MarkdownNode[] = [];
      const flush = () => {
        if (group.length) result.push(...transform(group));
        group = [];
      };
      for (const child of node.children) {
        if (
          offsets(child) &&
          ((child.type === "text" && child.value != null) ||
            isBareAutolink(child))
        )
          group.push(child);
        else {
          flush();
          visit(child);
          result.push(child);
        }
      }
      flush();
      node.children = result;
    };
    visit(tree);
  };
}
