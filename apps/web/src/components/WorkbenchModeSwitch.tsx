import { useId, useRef, useState, type CSSProperties } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import "../workbench-mode-switch.css";

type Props = {
  mode: WorkbenchMode;
  onChange: (mode: WorkbenchMode) => void;
  disabled?: boolean;
};

const labeledModes: WorkbenchMode[] = ["session", "terminal", "codex"];

/** The rail retains its two-position gesture; labeled choices include Codex. */
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
        if (
          disabled ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        event.preventDefault();
        const target = event.target as HTMLElement;
        if (event.key === "Home") choose("session");
        else if (event.key === "End") choose("codex");
        else if (target.closest(".mode-switch-rail")) {
          choose(event.key === "ArrowLeft" ? "session" : "terminal");
        } else {
          const focusedMode =
            target.closest<HTMLElement>("[data-choice]")?.dataset.choice;
          const index = labeledModes.indexOf(
            (focusedMode ?? mode) as WorkbenchMode,
          );
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          choose(
            labeledModes[
              Math.max(0, Math.min(labeledModes.length - 1, index + direction))
            ],
          );
        }
      }}
    >
      <button
        type="button"
        className="mode-switch-label"
        data-choice="session"
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
        data-choice="terminal"
        aria-pressed={mode === "terminal"}
        disabled={disabled && mode !== "terminal"}
        onClick={() => choose("terminal")}
      >
        终端
      </button>
      <button
        type="button"
        className="mode-switch-label mode-switch-codex"
        data-choice="codex"
        aria-pressed={mode === "codex"}
        disabled={disabled && mode !== "codex"}
        onClick={() => choose("codex")}
      >
        Codex
      </button>
      <span id={helpId} className="mode-switch-help">
        轨道左侧会话，右侧终端，点击或左右拖动切换。Codex
        使用独立按钮；标签支持方向键、Home 和 End。
      </span>
    </div>
  );
}
