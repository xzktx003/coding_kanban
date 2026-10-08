import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import {
  sessionPortalContainer,
  useSessionInteractionVisible,
} from "@session/session-dom";
function UndoNotice({
  id,
  label,
  undo,
}: {
  id: string | number;
  label: string;
  undo: () => void | Promise<void>;
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
      const next = dialogs.item(dialogs.length - 1) ?? root;
      setContainer((current) => (current === next ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
  const [busy, setBusy] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pause = () => clearTimeout(timer.current);
  const resume = () => {
    pause();
    timer.current = setTimeout(() => toast.dismiss(id), 8000);
  };
  useEffect(() => {
    resume();
    return pause;
  }, []);
  if (!visible || !container) return null;
  return createPortal(
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
          pause();
          setBusy(true);
          try {
            await undo();
            toast.dismiss(id);
          } catch (e) {
            toast.error(String(e));
            setBusy(false);
            resume();
          }
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
    </div>,
    container,
  );
}
export function offerUndo(label: string, undo: () => void | Promise<void>) {
  toast.custom((id) => <UndoNotice id={id} label={label} undo={undo} />, {
    duration: Infinity,
  });
}
