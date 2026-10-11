import { type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@session/components/ui/dialog";
import { useComposerSheetHistory } from "./useComposerSheetHistory";

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
  useComposerSheetHistory(onClose);
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
