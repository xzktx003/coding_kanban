import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useTranscriptState } from "../thread/rowState";
import { useCodexStore } from "../stores/useCodexStore";
import { TranscriptDetailsNotice } from "./TranscriptDetailsNotice";
import type { CommandActionSource } from "../thread/deriveRenderItems";
import {
  ansiSegments,
  commandDurationLabel,
  nativeShellName,
  normalizeNativeCommand,
} from "../presentation/nativeCommand";
import {
  NativeCommandChevron,
  NativeCommandCopy,
  NativeCommandSuccess,
  NativeCommandTerminal,
} from "../presentation/NativeCommandIcons";

type ShellCommandProps = Omit<Partial<CommandActionSource>, "commandItemId"> & {
  command: string;
  commandItemId: string | null | undefined;
};

function CommandCopy({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation("thread");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="codex-command-copy"
      aria-label={state === "copied" ? t("command.copied") : label}
      title={label}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? <NativeCommandSuccess /> : <NativeCommandCopy />}
      {state === "failed" && (
        <span role="status" className="codex-command-copy-error">
          {t("command.copyFailed")}
        </span>
      )}
    </button>
  );
}

export function ShellCommand(props: ShellCommandProps) {
  const key = JSON.stringify([
    props.threadId,
    props.turnId,
    props.commandItemId,
    props.command,
  ]);
  return <ShellCommandContent key={key} {...props} />;
}

function ShellCommandContent({
  command,
  commandItemId,
  aggregatedOutput,
  status: capturedStatus,
  durationMs: capturedDuration,
  startedAtMs,
  exitCode,
  termination,
  cwd,
  threadId,
  turnId,
  transcriptMetadataOnly = false,
}: ShellCommandProps) {
  const { t } = useTranslation("thread");
  const key = JSON.stringify([threadId, turnId, commandItemId, command]);
  const [expanded, setExpanded] = useTranscriptState(`shell-${key}`, false);
  const [fullCommand, setFullCommand] = useTranscriptState(
    `shell-command-${key}`,
    false,
  );
  const [reading, setReading] = useTranscriptState<{
    top: number;
    left: number;
  } | null>(`shell-output-${key}`, null);
  const outputRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const legacyStatus = useCodexStore((s) =>
    commandItemId ? s.commandStatusMap[commandItemId] : undefined,
  );
  const legacyDuration = useCodexStore((s) =>
    commandItemId ? s.commandDurationMap[commandItemId] : undefined,
  );
  const status = capturedStatus ?? (threadId ? undefined : legacyStatus);
  const durationMs =
    capturedDuration === undefined
      ? threadId
        ? undefined
        : legacyDuration
      : capturedDuration;
  const running = status === "inProgress" && !termination;
  const stopped = termination === "interrupted";
  const rootRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const nativeStart =
    typeof startedAtMs === "number" &&
    Number.isFinite(startedAtMs) &&
    startedAtMs > 0
      ? startedAtMs
      : null;
  useEffect(() => {
    if (!running || nativeStart === null) return;
    const tick = () => {
      if (!document.hidden && !rootRef.current?.closest("[hidden]"))
        setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running, nativeStart]);
  const elapsed = commandDurationLabel(
    running && nativeStart !== null
      ? Math.max(0, now - nativeStart)
      : durationMs,
  );
  const display = useMemo(() => normalizeNativeCommand(command), [command]);
  const shell = nativeShellName(command) ?? t("command.shell");
  const output = transcriptMetadataOnly
    ? ""
    : aggregatedOutput && /\S/.test(aggregatedOutput)
      ? aggregatedOutput
      : running
        ? ""
        : t("command.noOutput");
  const tokens = useMemo(
    () => (expanded ? ansiSegments(output) : []),
    [expanded, output],
  );
  useLayoutEffect(() => {
    if (expanded && outputRef.current && reading) {
      outputRef.current.scrollTop = reading.top;
      outputRef.current.scrollLeft = reading.left;
    }
  }, [expanded]);
  const summary = t(
    `command.${stopped ? "stoppedSummary" : running ? "running" : status === "declined" ? "declinedSummary" : expanded ? "ranGeneric" : "ran"}${elapsed ? "Elapsed" : ""}`,
    {
      command: expanded ? t("command.generic") : display,
      ...(elapsed ? { elapsed } : {}),
    },
  );
  return (
    <div
      className="codex-command"
      ref={rootRef}
      data-command-id={commandItemId}
      data-command-status={running ? "inProgress" : status}
    >
      <button
        type="button"
        className="codex-command-summary"
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={command}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="codex-command-summary-content">
          <NativeCommandTerminal className="codex-command-terminal" />
          <span className="codex-command-summary-label">{summary}</span>
          {transcriptMetadataOnly && <TranscriptDetailsNotice />}
        </span>
        <NativeCommandChevron
          className="codex-command-chevron"
          data-expanded={expanded}
        />
      </button>
      {expanded && (
        <div
          id={bodyId}
          className="codex-command-body"
          data-testid="exec-shell-body"
        >
          <div className="codex-command-shell">
            <div className="codex-command-shell-name" title={cwd}>
              {shell}
            </div>
            <div className="codex-command-line-wrap">
              <div
                role="button"
                tabIndex={0}
                className="codex-command-line"
                aria-expanded={fullCommand}
                aria-label={`$ ${display}`}
                data-expanded={fullCommand}
                onClick={() => setFullCommand((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setFullCommand((value) => !value);
                  }
                }}
              >
                <span className="codex-command-prompt">$</span>
                <code>{display}</code>
              </div>
              {!transcriptMetadataOnly && (
                <CommandCopy text={display} label={t("command.copyCommand")} />
              )}
            </div>
            <div className="codex-command-output-wrap">
              <div
                className="codex-command-output"
                ref={outputRef}
                tabIndex={0}
                aria-label={t("command.output")}
                onScroll={(event) =>
                  setReading({
                    top: event.currentTarget.scrollTop,
                    left: event.currentTarget.scrollLeft,
                  })
                }
              >
                <div className="codex-command-output-content">
                  {transcriptMetadataOnly ? (
                    <TranscriptDetailsNotice />
                  ) : (
                    <code>
                      {tokens.map((segment, index) => (
                        <span
                          key={index}
                          className={segment.className}
                          style={segment.style}
                        >
                          {segment.text}
                        </span>
                      ))}
                    </code>
                  )}
                </div>
              </div>
              {!transcriptMetadataOnly && (
                <CommandCopy
                  text={aggregatedOutput ?? ""}
                  label={t("command.copyOutput")}
                />
              )}
            </div>
            <div className="codex-command-footer" aria-live="polite">
              {!running && (
                <span>
                  {stopped ? (
                    t("command.stopped")
                  ) : status === "declined" ? (
                    t("command.declined")
                  ) : exitCode === 0 && !termination ? (
                    <>
                      <NativeCommandSuccess />
                      {t("command.success")}
                    </>
                  ) : (
                    t("command.exitCode", {
                      code: exitCode ?? t("command.unknown"),
                    })
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
