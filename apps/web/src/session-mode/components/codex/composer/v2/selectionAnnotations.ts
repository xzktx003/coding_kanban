import type { ComposerContext } from "@agent-orchestrator/shared";
import { sessionWindowId } from "@session/services/sessionWindowContext";

export type ResponseSelection = { text: string; start: number; end: number };
export type AnnotatedContext = ComposerContext & {
  annotation?: string;
  responseSelection?: { start: number; end: number };
};

export function isCodexDraftOwner(owner: string): boolean {
  try {
    let parts: unknown = JSON.parse(owner);
    const windowId = sessionWindowId();
    if (Array.isArray(parts) && parts[0] === "window") {
      if (
        !windowId ||
        parts.length !== 3 ||
        parts[1] !== windowId ||
        typeof parts[2] !== "string"
      )
        return false;
      parts = JSON.parse(parts[2]);
    } else if (windowId) {
      return false;
    }
    return Array.isArray(parts) && parts[0] === "codex";
  } catch {
    return false;
  }
}

export function captureResponseSelection(
  root: Element,
  range: Range,
): ResponseSelection | null {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const rawText = range.toString();
  const text = rawText.trim();
  if (!text || text.length > 180_000 || text.includes("\0")) return null;

  const offset = (container: Node, position: number) => {
    if (container.nodeType === Node.TEXT_NODE) {
      const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
      );
      let total = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node === container) return total + position;
        total += node.length;
      }
      return total;
    }
    const prefix = root.ownerDocument.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(container, position);
    return prefix.toString().length;
  };
  const rawStart = offset(range.startContainer, range.startOffset);
  const rawEnd = offset(range.endContainer, range.endOffset);
  if (rawEnd <= rawStart) return null;
  const leading = rawText.length - rawText.trimStart().length;
  const trailing = rawText.length - rawText.trimEnd().length;
  const start = rawStart + leading;
  const end = rawEnd - trailing;
  if (end <= start) return null;
  return { text, start, end };
}

type TextBoundary = { node: Text; offset: number; absolute: number };

function textBoundaries(root: Element): TextBoundary[] {
  const boundaries: TextBoundary[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let absolute = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    boundaries.push({ node, offset: 0, absolute });
    boundaries.push({
      node,
      offset: node.length,
      absolute: absolute + node.length,
    });
    absolute += node.length;
  }
  return boundaries;
}

function boundaryCandidates(
  boundaries: TextBoundary[],
  absolute: number,
): TextBoundary[] {
  const candidates: TextBoundary[] = [];
  for (let index = 0; index < boundaries.length; index += 2) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (!end) continue;
    if (absolute === start.absolute) candidates.push(start);
    else if (absolute === end.absolute) candidates.push(end);
    else if (absolute > start.absolute && absolute < end.absolute)
      candidates.push({
        node: start.node,
        offset: absolute - start.absolute,
        absolute,
      });
  }
  // A block boundary can contain a serialized newline that has no text node
  // of its own. Preserve both adjacent DOM endpoints so the exact Range
  // string can still be reconstructed.
  if (candidates.length === 0 && boundaries.length) {
    const first = boundaries[0];
    const last = boundaries.at(-1)!;
    if (absolute <= first.absolute) candidates.push(first);
    else if (absolute >= last.absolute) candidates.push(last);
  }
  return candidates;
}

export function findResponseSelection(
  root: Element,
  selection: ResponseSelection,
): Range | null {
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start
  )
    return null;
  const boundaries = textBoundaries(root);
  const starts = boundaryCandidates(boundaries, selection.start);
  const ends = boundaryCandidates(boundaries, selection.end);
  for (const start of starts) {
    for (const end of ends) {
      const range = root.ownerDocument.createRange();
      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
      } catch {
        continue;
      }
      if (range.toString() === selection.text) return range;
    }
  }
  return null;
}
export function contextForDelivery(context: AnnotatedContext): ComposerContext {
  const { annotation, responseSelection: _selection, ...compatible } = context;
  const note = annotation?.trim();
  return note
    ? {
        ...compatible,
        text: `所选文本：\n${context.text}\n\n用户评论：\n${note}`,
      }
    : compatible;
}
