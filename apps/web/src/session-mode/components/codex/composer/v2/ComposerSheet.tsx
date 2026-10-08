import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@session/components/ui/dialog";
import { useSessionInteractionVisible } from "@session/session-dom";
let pendingClose: string | null = null;

export function ComposerSheet({
  title,
  description,
  onClose,
  children,
  footer,
  full = false,
  returnFocus,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  returnFocus?: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const visible = useSessionInteractionVisible();
  // A sheet consumes one browser Back step; closing it never navigates away from the session.
  useEffect(() => {
    if (!visible) return;
    const marker = crypto.randomUUID();
    if (pendingClose && history.state?.composerSheet === pendingClose)
      history.replaceState({ ...history.state, composerSheet: marker }, "");
    else history.pushState({ ...history.state, composerSheet: marker }, "");
    pendingClose = null;
    const back = () => {
      if (history.state?.composerSheet !== marker) close.current();
    };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      if (history.state?.composerSheet === marker) {
        pendingClose = marker;
        queueMicrotask(() => {
          if (pendingClose === marker) {
            pendingClose = null;
            if (history.state?.composerSheet === marker) history.back();
          }
        });
      }
    };
  }, [visible]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`session-composer-sheet ${full ? "is-full" : ""}`}
        onCloseAutoFocus={
          returnFocus
            ? (e) => {
                e.preventDefault();
                returnFocus();
              }
            : undefined
        }
        onPointerDownOutside={(e) => {
          if (full) e.preventDefault();
        }}
      >
        <header>
          <button
            type="button"
            onClick={onClose}
            aria-label={full ? "返回并保留草稿" : "关闭面板"}
          >
            {full ? <ArrowLeft /> : <X />}
          </button>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ?? "修改只影响当前草稿，完成后再发送。"}
            </DialogDescription>
          </div>
        </header>
        <div className="session-composer-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </DialogContent>
    </Dialog>
  );
}
