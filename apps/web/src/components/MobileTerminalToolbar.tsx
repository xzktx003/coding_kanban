import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import {
  createMobilePressRepeater,
  getMobileTerminalControlInput,
  isMobileTerminalControlRepeatable,
  MOBILE_TERMINAL_CONTROLS,
  MOBILE_TERMINAL_TOOLBAR_ORDER,
  type MobilePressRepeater,
  type MobileTerminalControlId,
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
              <dd>
                {control.description}
                {isMobileTerminalControlRepeatable(control.id)
                  ? "；长按可连续发送"
                  : ""}
              </dd>
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
  const [inputError, setInputError] = useState<string | null>(null);
  const repeaterRef = useRef<MobilePressRepeater | null>(null);
  const suppressClickRef = useRef<MobileTerminalControlId | null>(null);

  const stopRepeating = () => {
    repeaterRef.current?.stop();
    repeaterRef.current = null;
  };

  useEffect(() => stopRepeating, []);

  const sendControl = async (
    controlId: MobileTerminalControlId,
    shiftedForPress = shifted,
  ) => {
    const input = getMobileTerminalControlInput(controlId, shiftedForPress);
    setShifted(false);
    setInputError(null);
    try {
      await onSendInput(input);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "快捷键发送失败");
      throw error;
    }
  };

  const sendControlWithoutUnhandledRejection = (
    controlId: MobileTerminalControlId,
  ) => {
    void sendControl(controlId).catch(() => undefined);
  };

  const startRepeating = (
    event: ReactPointerEvent<HTMLButtonElement>,
    controlId: MobileTerminalControlId,
  ) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    stopRepeating();
    suppressClickRef.current = controlId;
    const shiftedForPress = shifted;
    const repeater = createMobilePressRepeater(() =>
      sendControl(controlId, shiftedForPress),
    );
    repeaterRef.current = repeater;
    repeater.start();
  };

  const stopRepeatingAfterPointer = (controlId: MobileTerminalControlId) => {
    stopRepeating();
    globalThis.setTimeout(() => {
      if (suppressClickRef.current === controlId) {
        suppressClickRef.current = null;
      }
    }, 0);
  };

  const handleControlClick = (controlId: MobileTerminalControlId) => {
    if (suppressClickRef.current === controlId) {
      suppressClickRef.current = null;
      return;
    }
    sendControlWithoutUnhandledRejection(controlId);
  };

  return (
    <>
      <div
        aria-label="手机终端快捷键"
        className="mobile-terminal-toolbar"
        role="toolbar"
      >
        {MOBILE_TERMINAL_TOOLBAR_ORDER.map((item) => {
          if (item === "shift") {
            return (
              <button
                aria-pressed={shifted}
                className={`mobile-terminal-key mobile-terminal-key--modifier${shifted ? " active" : ""}`}
                disabled={disabled}
                key={item}
                onClick={() => setShifted((active) => !active)}
                title="为下一次快捷键启用 Shift"
                type="button"
              >
                Shift
              </button>
            );
          }
          if (item === "help") {
            return (
              <button
                aria-controls="mobile-terminal-shortcut-help"
                aria-expanded={showHelp}
                className="mobile-terminal-key mobile-terminal-key--help"
                key={item}
                onClick={() => setShowHelp(true)}
                type="button"
              >
                说明
              </button>
            );
          }

          const control = MOBILE_TERMINAL_CONTROLS.find(
            (candidate) => candidate.id === item,
          );
          if (!control) return null;
          const repeatable = isMobileTerminalControlRepeatable(control.id);
          const description = repeatable
            ? `${control.description}，长按连续发送`
            : control.description;
          return (
            <button
              aria-label={description}
              className={`mobile-terminal-key${repeatable ? " mobile-terminal-key--repeatable" : ""}${control.danger ? " mobile-terminal-key--danger" : ""}`}
              disabled={disabled}
              key={control.id}
              onClick={() => handleControlClick(control.id)}
              onContextMenu={
                repeatable ? (event) => event.preventDefault() : undefined
              }
              onLostPointerCapture={
                repeatable
                  ? () => stopRepeatingAfterPointer(control.id)
                  : undefined
              }
              onPointerCancel={
                repeatable
                  ? () => stopRepeatingAfterPointer(control.id)
                  : undefined
              }
              onPointerDown={
                repeatable
                  ? (event) => startRepeating(event, control.id)
                  : undefined
              }
              onPointerUp={
                repeatable
                  ? () => stopRepeatingAfterPointer(control.id)
                  : undefined
              }
              title={description}
              type="button"
            >
              {control.label}
            </button>
          );
        })}
      </div>
      {inputError && (
        <div className="mobile-terminal-input-error" role="alert">
          {inputError}
        </div>
      )}
      {showHelp && (
        <div id="mobile-terminal-shortcut-help">
          <MobileTerminalShortcutHelp onClose={() => setShowHelp(false)} />
        </div>
      )}
    </>
  );
}
