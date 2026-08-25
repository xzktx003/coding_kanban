export interface MarkdownHeading {
  id: string;
  level: number;
  line: number;
  text: string;
}

export const MARKDOWN_OUTLINE_ITEM_LIMIT = 500;

export function createMarkdownHeadingId(
  sourceLine: number | undefined,
): string | undefined {
  return sourceLine && sourceLine > 0
    ? `markdown-heading-${sourceLine}`
    : undefined;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, "$1")
    .trim();
}

export function extractMarkdownHeadings(
  content: string,
  limit = MARKDOWN_OUTLINE_ITEM_LIMIT,
): MarkdownHeading[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const headings: MarkdownHeading[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closingFence = /^\s{0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);
      if (closingFence) {
        const token = closingFence[1]!;
        if (token[0] === fence.marker && token.length >= fence.length) {
          fence = null;
        }
      }
      continue;
    }
    if (fenceMatch) {
      const token = fenceMatch[1]!;
      const marker = token[0] as "`" | "~";
      fence = { marker, length: token.length };
      continue;
    }

    const atx = /^\s{0,3}(#{1,6})(?:[\t ]+|$)(.*)$/.exec(line);
    if (atx) {
      const text = stripInlineMarkdown(
        (atx[2] ?? "").replace(/[\t ]+#+[\t ]*$/, ""),
      );
      if (text) {
        const sourceLine = index + 1;
        headings.push({
          id: createMarkdownHeadingId(sourceLine)!,
          level: atx[1]!.length,
          line: sourceLine,
          text,
        });
        if (headings.length >= limit) return headings;
      }
      continue;
    }

    const setext = /^\s{0,3}(=+|-+)[\t ]*$/.exec(line);
    const previousLine = index > 0 ? (lines[index - 1] ?? "") : "";
    if (
      setext &&
      previousLine.trim() &&
      !/^\s{4,}/.test(previousLine) &&
      !/^\s{0,3}>/.test(previousLine)
    ) {
      const text = stripInlineMarkdown(previousLine);
      if (text) {
        const sourceLine = index;
        headings.push({
          id: createMarkdownHeadingId(sourceLine)!,
          level: setext[1]!.startsWith("=") ? 1 : 2,
          line: sourceLine,
          text,
        });
        if (headings.length >= limit) return headings;
      }
    }
  }

  return headings;
}

export function calculateSyncedScrollTop({
  sourceScrollTop,
  sourceScrollHeight,
  sourceClientHeight,
  targetScrollHeight,
  targetClientHeight,
}: {
  sourceScrollTop: number;
  sourceScrollHeight: number;
  sourceClientHeight: number;
  targetScrollHeight: number;
  targetClientHeight: number;
}): number {
  const sourceRange = Math.max(0, sourceScrollHeight - sourceClientHeight);
  const targetRange = Math.max(0, targetScrollHeight - targetClientHeight);
  if (sourceRange === 0 || targetRange === 0) return 0;

  const ratio = Math.min(1, Math.max(0, sourceScrollTop / sourceRange));
  return ratio * targetRange;
}
