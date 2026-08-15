import { useEffect, useRef, useState } from "react";

import {
  getMobileTerminalControlInput,
  MOBILE_TERMINAL_CONTROLS,
} from "../lib/mobile-terminal-controls";

interface MobileTerminalToolbarProps {
  disabled?: boolean;
  onSendInput: (input: string) => Promise<void> | void;
}

interface MobileTerminalShortcutHelpProps {
  onClose: () => void;
}

export function MobileTerminalShortcutHelp({
  onClose,
}: MobileTerminalShortcutHelpProps) {
  const titleId = "mobile-terminal-shortcut-help-title";
  const panelRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    const panel = panelRef.current;
    if (!panel) return;

    panel.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        e.shiftKey
          ? document.activeElement === first
          : document.activeElement === last
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };

    panel.addEventListener("keydown", handleKeyDown);
    return () => {
      panel.removeEventListener("keydown", handleKeyDown);
      (previouslyFocused.current as HTMLElement | undefined)?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="mobile-terminal-help-backdrop" role="presentation">
      <section
        aria-label="手机终端快捷键说明"
        aria-labelledby={titleId}
        aria-modal="true"
        className="mobile-terminal-help-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="mobile-terminal-help-header">
          <div>
            <strong id={titleId}>快捷键说明</strong>
            <span>点击快捷键会直接发送到当前终端</span>
          </div>
          <button
            aria-label="关闭快捷键说明"
            className="mobile-terminal-help-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <dl className="mobile-terminal-help-list">
          <div className="mobile-terminal-help-item">
            <dt>Shift</dt>
            <dd>为下一次快捷键启用 Shift，发送后自动复位</dd>
          </div>
          {MOBILE_TERMINAL_CONTROLS.map((control) => (
            <div className="mobile-terminal-help-item" key={control.id}>
              <dt>{control.label}</dt>
              <dd>{control.description}</dd>
            </div>
          ))}
        </dl>
        <button
          className="mobile-terminal-help-confirm"
          onClick={onClose}
          type="button"
        >
          知道了
        </button>
      </section>
    </div>
  );
}

export function MobileTerminalToolbar({
  disabled = false,
  onSendInput,
}: MobileTerminalToolbarProps) {
  const [showHelp, setShowHelp] = useState(false);
  const [shifted, setShifted] = useState(false);

  const sendControl = (
    controlId: (typeof MOBILE_TERMINAL_CONTROLS)[number]["id"],
  ) => {
    const input = getMobileTerminalControlInput(controlId, shifted);
    setShifted(false);
    void onSendInput(input);
  };

  return (
    <>
      <div
        aria-label="手机终端快捷键"
        className="mobile-terminal-toolbar"
        role="toolbar"
      >
        <button
          aria-controls="mobile-terminal-shortcut-help"
          aria-expanded={showHelp}
          className="mobile-terminal-key mobile-terminal-key--help"
          onClick={() => setShowHelp(true)}
          type="button"
        >
          说明
        </button>
        <button
          aria-pressed={shifted}
          className={`mobile-terminal-key mobile-terminal-key--modifier${shifted ? " active" : ""}`}
          disabled={disabled}
          onClick={() => setShifted((active) => !active)}
          title="为下一次快捷键启用 Shift"
          type="button"
        >
          Shift
        </button>
        {MOBILE_TERMINAL_CONTROLS.map((control) => (
          <button
            className={`mobile-terminal-key${control.danger ? " mobile-terminal-key--danger" : ""}`}
            disabled={disabled}
            key={control.id}
            onClick={() => sendControl(control.id)}
            title={control.description}
            type="button"
          >
            {control.label}
          </button>
        ))}
      </div>
      {showHelp && (
        <div id="mobile-terminal-shortcut-help">
          <MobileTerminalShortcutHelp onClose={() => setShowHelp(false)} />
        </div>
      )}
    </>
  );
}
