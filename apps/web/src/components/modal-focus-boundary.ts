import { useLayoutEffect, type RefObject } from "react";

const focusableSelector =
  'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]';

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  const view = dialog.ownerDocument.defaultView;
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.matches(':disabled, [aria-disabled="true"]') ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      return false;
    for (
      let node: HTMLElement | null = element;
      node;
      node = node.parentElement
    ) {
      const style = view?.getComputedStyle(node);
      if (style?.display === "none" || style?.visibility === "hidden")
        return false;
      if (node === dialog) break;
    }
    return true;
  });
}

/** Contains focus without changing modal dismissal or business actions. */
export function activateModalFocusBoundary(
  dialog: HTMLElement,
  initialFocus?: HTMLElement | null,
): () => void {
  const doc = dialog.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  const focusFirst = () =>
    (focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
  const onFocus = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) focusFirst();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const elements = focusableElements(dialog);
    const first = elements[0] ?? dialog;
    const last = elements.at(-1) ?? dialog;
    if (
      !elements.length ||
      !dialog.contains(doc.activeElement) ||
      (event.shiftKey && doc.activeElement === first) ||
      (!event.shiftKey && doc.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  doc.addEventListener("focusin", onFocus);
  dialog.addEventListener("keydown", onKey);
  if (initialFocus && dialog.contains(initialFocus))
    initialFocus.focus({ preventScroll: true });
  else focusFirst();
  return () => {
    doc.removeEventListener("focusin", onFocus);
    dialog.removeEventListener("keydown", onKey);
    if (previous?.isConnected && previous.closest("[hidden], [inert]") === null)
      previous.focus({ preventScroll: true });
  };
}

export function useModalFocusBoundary(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    return activateModalFocusBoundary(
      dialogRef.current,
      initialFocusRef?.current,
    );
  }, [open, dialogRef, initialFocusRef]);
}
