import type { WorkbenchMode } from "../lib/workbench-mode";
import "../workbench-mode-switch.css";

type Props = {
  mode: WorkbenchMode;
  onChange: (mode: WorkbenchMode) => void;
  disabled?: boolean;
};

const modes: Array<{ mode: WorkbenchMode; label: string }> = [
  { mode: "session", label: "会话" },
  { mode: "terminal", label: "终端" },
  { mode: "codex", label: "Codex" },
];

export function WorkbenchModeSwitch({
  mode,
  onChange,
  disabled = false,
}: Props) {
  const choose = (next: WorkbenchMode) => {
    if (!disabled) onChange(next);
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
        if (event.key === "Home") choose("session");
        else if (event.key === "End") choose("codex");
        else {
          const target = event.target as HTMLElement;
          const focusedMode =
            target.closest<HTMLElement>("[data-choice]")?.dataset.choice;
          const index = modes.findIndex(
            (entry) => entry.mode === (focusedMode ?? mode),
          );
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          choose(
            modes[Math.max(0, Math.min(modes.length - 1, index + direction))]
              .mode,
          );
        }
      }}
    >
      {modes.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          className={`mode-switch-label mode-switch-${entry.mode}`}
          data-choice={entry.mode}
          aria-pressed={mode === entry.mode}
          disabled={disabled && mode !== entry.mode}
          onClick={() => choose(entry.mode)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
