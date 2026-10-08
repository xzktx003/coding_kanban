export function isLargePaste(text: string) {
  return text.length > 2000 || text.split(/\r?\n/).length > 40;
}
export function insertAtSelection(
  value: string,
  start: number,
  end: number,
  text: string,
) {
  const a = Math.max(0, Math.min(value.length, start));
  const b = Math.max(a, Math.min(value.length, end));
  return value.slice(0, a) + text + value.slice(b);
}
export interface DraftBlock {
  kind: "text" | "code";
  raw: string;
  text: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  language?: string;
  fence?: string;
}
/** Offsets reference the original string. No Markdown -> HTML -> text round trip. */
export function splitDraftBlocks(value: string): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(\r?\n)/gm;
  let cursor = 0,
    match: RegExpExecArray | null;
  const text = (a: number, b: number) => {
    if (a < b)
      blocks.push({
        kind: "text",
        raw: value.slice(a, b),
        text: value.slice(a, b),
        start: a,
        end: b,
        contentStart: a,
        contentEnd: b,
      });
  };
  while ((match = opening.exec(value))) {
    const fence = match[2];
    const closing = new RegExp(
      `^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`,
      "gm",
    );
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(value);
    if (!end) break;
    text(cursor, match.index);
    cursor = end.index + end[0].length;
    blocks.push({
      kind: "code",
      raw: value.slice(match.index, cursor),
      start: match.index,
      end: cursor,
      contentStart: opening.lastIndex,
      contentEnd: end.index,
      text: value.slice(opening.lastIndex, end.index),
      language: match[3].trim(),
      fence,
    });
    opening.lastIndex = cursor;
  }
  text(cursor, value.length);
  return blocks;
}
export function replaceDraftBlock(
  value: string,
  block: DraftBlock,
  text: string,
) {
  if (block.kind === "code" && block.fence) {
    const longest = Math.max(
      0,
      ...(text.match(new RegExp(`${block.fence[0]}+`, "g")) ?? []).map(
        (s) => s.length,
      ),
    );
    if (longest >= block.fence.length) {
      const fence = block.fence[0].repeat(longest + 1);
      const open = value
        .slice(block.start, block.contentStart)
        .replace(block.fence, fence);
      const close = value
        .slice(block.contentEnd, block.end)
        .replace(new RegExp(`${block.fence[0]}+`), fence);
      return (
        value.slice(0, block.start) +
        open +
        text +
        close +
        value.slice(block.end)
      );
    }
  }
  return (
    value.slice(0, block.contentStart) + text + value.slice(block.contentEnd)
  );
}
