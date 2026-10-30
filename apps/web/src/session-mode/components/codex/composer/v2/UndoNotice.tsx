import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import {
  sessionPortalContainer,
  useSessionInteractionVisible,
} from "@session/session-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../ui/dialog";
import { Button } from "../../../ui/button";
type UndoConfirmation = {
  title: string;
  description: string;
  actionLabel: string;
};
function UndoNotice({
  id,
  label,
  undo,
  confirmation,
}: {
  id: string | number;
  label: string;
  undo: () => void | Promise<void>;
  confirmation?: UndoConfirmation;
}) {
  const root = sessionPortalContainer();
  const visible = useSessionInteractionVisible();
  const [container, setContainer] = useState<HTMLElement | null>(root ?? null);
  useEffect(() => {
    if (!root) return;
    const update = () => {
      const dialogs = root.querySelectorAll<HTMLElement>(
        '[data-slot="dialog-content"][data-state="open"]',
      );
      // The undo notice can own its confirmation. Moving the whole notice into
      // that descendant would destroy/remount its own dialog portal.
      const candidates = Array.from(dialogs).filter(
        (dialog) => dialog.dataset.undoConfirmationId !== String(id),
      );
      const next = candidates.at(-1) ?? root;
      setContainer((current) => (current === next ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
  const [busy, setBusy] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const held = useRef(false);
  const pause = () => clearTimeout(timer.current);
  const resume = () => {
    pause();
    if (held.current) return;
    timer.current = setTimeout(() => toast.dismiss(id), 8000);
  };
  useEffect(() => {
    resume();
    return pause;
  }, []);
  if (!visible || !container) return null;
  const run = async () => {
    pause();
    held.current = true;
    setBusy(true);
    try {
      await undo();
      toast.dismiss(id);
    } catch (error) {
      toast.error(String(error));
      setBusy(false);
      if (!confirmOpen) {
        held.current = false;
        resume();
      }
    }
  };
  return createPortal(
    <>
      <div
        className="session-undo-notice"
        role="status"
        onPointerEnter={pause}
        onPointerLeave={(e) => {
          if (!e.currentTarget.contains(document.activeElement)) resume();
        }}
        onFocus={pause}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) resume();
        }}
      >
        <span>{label}</span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (confirmation) {
              pause();
              held.current = true;
              setConfirmOpen(true);
            } else await run();
          }}
        >
          {busy ? "正在恢复…" : "撤销"}
        </button>
        <button
          type="button"
          aria-label="关闭撤销提示"
          onClick={() => toast.dismiss(id)}
        >
          ×
        </button>
      </div>
      {confirmation && (
        <Dialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (busy) return;
            setConfirmOpen(open);
            held.current = open;
            if (!open) resume();
          }}
        >
          <DialogContent data-undo-confirmation-id={String(id)}>
            <DialogTitle>{confirmation.title}</DialogTitle>
            <DialogDescription>{confirmation.description}</DialogDescription>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirmOpen(false);
                  held.current = false;
                  resume();
                }}
              >
                取消
              </Button>
              <Button type="button" disabled={busy} onClick={() => void run()}>
                {busy ? "正在恢复…" : confirmation.actionLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>,
    container,
  );
}
export function offerUndo(
  label: string,
  undo: () => void | Promise<void>,
  confirmation?: UndoConfirmation,
) {
  toast.custom(
    (id) => (
      <UndoNotice
        id={id}
        label={label}
        undo={undo}
        confirmation={confirmation}
      />
    ),
    {
      duration: Infinity,
    },
  );
}
