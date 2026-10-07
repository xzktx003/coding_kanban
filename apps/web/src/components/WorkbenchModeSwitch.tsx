import { useId, useRef, useState, type CSSProperties } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import "../workbench-mode-switch.css";

type Props = {
  mode: WorkbenchMode;
  onChange: (mode: WorkbenchMode) => void;
  disabled?: boolean;
};

/** A shared two-position control. Only a completed gesture changes workspace mode. */
export function WorkbenchModeSwitch({
  mode,
  onChange,
  disabled = false,
}: Props) {
  const helpId = useId();
  const drag = useRef<{ id: number; start: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const choose = (next: WorkbenchMode) => {
    if (!disabled || next === mode) onChange(next);
  };
  return (
    <div
      className="workbench-mode-switch"
      role="group"
      aria-label="工作模式"
      data-mode={mode}
      onKeyDown={(event) => {
        if (disabled || !["ArrowLeft", "ArrowRight"].includes(event.key))
          return;
        event.preventDefault();
        choose(event.key === "ArrowLeft" ? "session" : "terminal");
      }}
    >
      <button
        type="button"
        className="mode-switch-label"
        aria-pressed={mode === "session"}
        disabled={disabled && mode !== "session"}
        onClick={() => choose("session")}
      >
        会话
      </button>
      <button
        type="button"
        role="switch"
        aria-label="工作模式"
        aria-checked={mode === "terminal"}
        aria-describedby={helpId}
        disabled={disabled}
        className="mode-switch-rail"
        data-dragging={progress !== null}
        style={
          {
            "--switch-progress": progress ?? (mode === "terminal" ? 1 : 0),
          } as CSSProperties
        }
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          choose(mode === "session" ? "terminal" : "session");
        }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          suppressClick.current = false;
          drag.current = {
            id: event.pointerId,
            start: event.clientX,
            moved: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          gesture.moved ||= Math.abs(event.clientX - gesture.start) >= 5;
          if (gesture.moved) {
            const box = event.currentTarget.getBoundingClientRect();
            setProgress(
              Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
            );
          }
        }}
        onPointerUp={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          drag.current = null;
          setProgress(null);
          if (gesture.moved) {
            suppressClick.current = true;
            const box = event.currentTarget.getBoundingClientRect();
            choose(
              event.clientX >= box.left + box.width / 2
                ? "terminal"
                : "session",
            );
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setProgress(null);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setProgress(null);
        }}
      >
        <span className="mode-switch-track" aria-hidden="true">
          <span className="mode-switch-thumb" />
        </span>
      </button>
      <button
        type="button"
        className="mode-switch-label"
        aria-pressed={mode === "terminal"}
        disabled={disabled && mode !== "terminal"}
        onClick={() => choose("terminal")}
      >
        终端
      </button>
      <span id={helpId} className="mode-switch-help">
        左侧会话，右侧终端。点击或左右拖动切换。
      </span>
    </div>
  );
}
