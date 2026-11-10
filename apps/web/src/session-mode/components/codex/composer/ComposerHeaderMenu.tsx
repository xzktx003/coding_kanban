import { useEffect, useRef, useState } from "react";

export function ComposerHeaderMenu({ onSettings, onShortcuts }: { onSettings: () => void; onShortcuts: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div ref={root} className="session-composer-header-menu">
      <button ref={trigger} type="button" aria-label="Codex 菜单" title="设置" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Codex</button>
      {open && (
        <div role="menu" aria-label="Codex 菜单">
          <button type="button" role="menuitem" onClick={() => choose(onSettings)}>Codex 设置</button>
          <button type="button" role="menuitem" onClick={() => choose(onShortcuts)}>键盘快捷键</button>
        </div>
      )}
    </div>
  );
}
