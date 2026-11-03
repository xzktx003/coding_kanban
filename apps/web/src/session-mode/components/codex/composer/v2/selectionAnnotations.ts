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
  const text = range.toString().trim();
  if (!text || text.length > 180_000 || text.includes("\0")) return null;
  let start = 0;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      if (walker.currentNode === range.startContainer) {
        start += range.startOffset;
        break;
      }
      start += (walker.currentNode as Text).length;
    }
  } else {
    const prefix = root.ownerDocument.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    start = prefix.toString().length;
  }
  return { text, start, end: start + range.toString().length };
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
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const range = root.ownerDocument.createRange();
  let offset = 0,
    started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const end = offset + node.length;
    if (!started && selection.start < end) {
      range.setStart(node, selection.start - offset);
      started = true;
    }
    if (started && selection.end <= end) {
      range.setEnd(node, selection.end - offset);
      return range.toString().trim() === selection.text ? range : null;
    }
    offset = end;
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
