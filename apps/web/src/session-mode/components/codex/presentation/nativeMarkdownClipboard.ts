import { copyTextToClipboard } from "../../../../lib/clipboard";

/** Preserve native plain/rich payloads on HTTPS and on nonsecure LAN HTTP. */
export async function writeNativeMarkdownClipboard(
  text: string,
  html?: string,
) {
  const clipboard = navigator.clipboard;
  if (
    html !== undefined &&
    typeof ClipboardItem !== "undefined" &&
    clipboard?.write
  ) {
    return clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  }
  if (clipboard?.writeText) {
    return clipboard.writeText(text);
  }
  // The legacy copy must run within the original user gesture. Reuse the
  // application's textarea fallback, adding sanitized rich data and restoring
  // the previous focus/selection rather than leaving the composer blurred.
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const inputSelection =
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement
      ? {
          start: focused.selectionStart,
          end: focused.selectionEnd,
          direction: focused.selectionDirection,
        }
      : null;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    if (html !== undefined) event.clipboardData.setData("text/html", html);
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  try {
    if (!(await copyTextToClipboard(text)))
      throw new Error("Clipboard copy failed");
  } finally {
    document.removeEventListener("copy", onCopy);
    if (focused instanceof HTMLElement && focused.isConnected) {
      focused.focus({ preventScroll: true });
      if (
        inputSelection &&
        inputSelection.start !== null &&
        inputSelection.end !== null
      ) {
        (focused as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
          inputSelection.start,
          inputSelection.end,
          inputSelection.direction ?? undefined,
        );
      }
    }
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) {
        if (range.commonAncestorContainer.isConnected)
          selection.addRange(range);
      }
    }
  }
}
