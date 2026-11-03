import { useState } from "react";

import {
  TERMUX_EXTRA_KEY_ROWS,
  applyTermuxExtraKey,
  type TermuxExtraKey,
  type TermuxModifierState,
} from "../lib/termux-extra-keys";

const idle: TermuxModifierState = { ctrl: false, alt: false };

export function MobileTerminalAccessory({
  disabled = false,
  onSendInput,
}: {
  disabled?: boolean;
  onSendInput: (input: string) => Promise<void> | void;
}) {
  const [modifiers, setModifiers] = useState<TermuxModifierState>(idle);
  const [error, setError] = useState<string | null>(null);

  const press = (key: TermuxExtraKey) => {
    const result = applyTermuxExtraKey(key, modifiers);
    setModifiers(result.modifiers);
    if (!result.bytes) return;
    setError(null);
    void Promise.resolve(onSendInput(result.bytes)).catch((sendError: unknown) => {
      setError(sendError instanceof Error ? sendError.message : "快捷键发送失败");
    });
  };

  return (
    <div className="mobile-terminal-accessory">
      <div aria-label="Termux 扩展键" className="termux-extra-keys" role="toolbar">
        {TERMUX_EXTRA_KEY_ROWS.map((row) => (
          <div className="termux-extra-key-row" key={row.join("-")}>
            {row.map((key) => {
              const locked =
                (key === "CTRL" && modifiers.ctrl) ||
                (key === "ALT" && modifiers.alt);
              return (
                <button
                  aria-pressed={key === "CTRL" || key === "ALT" ? locked : undefined}
                  className={`termux-extra-key${locked ? " termux-extra-key--locked" : ""}`}
                  disabled={disabled}
                  key={key}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || disabled) return;
                    event.preventDefault();
                    press(key);
                  }}
                  type="button"
                >
                  {key}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {error && (
        <p className="mobile-terminal-input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
