import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  type RefObject,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useTranscriptState } from "../thread/rowState";
import { useCodexStore } from "../stores/useCodexStore";
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

import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import type { CommandDetailItem } from "./commandDetail";
import { useCommandDetail } from "./useCommandDetail";
import { NativeMessageCopied } from "@session/features/thread-workflows/NativeMessageIcons";
import { useNativeCopyFeedback } from "../presentation/useNativeCopyFeedback";
import { NativeMarkdownTooltip } from "../presentation/NativeMarkdownTooltip";

type ShellCommandProps = Omit<Partial<CommandActionSource>, "commandItemId"> & {
  command: string;
  commandItemId: string | null | undefined;
  explorationSummary?: ReactNode;
  explorationType?: "read" | "search" | "listFiles";
};

function CommandCopy({ text, label }: { text: string; label: string }) {
  const { t, i18n } = useTranslation("thread");
  const { copied, copyPending, copy } = useNativeCopyFeedback([text], {
    feedbackMs: 2000,
    language: i18n?.language ?? "zh",
  });
  const copyLabel = copied ? t("command.copied") : label;
  return (
    <NativeMarkdownTooltip label={copyLabel}>
      <button
        type="button"
        className="codex-command-copy"
        aria-label={copyLabel}
        title={copyLabel}
        disabled={!text}
        aria-busy={copyPending || undefined}
        aria-disabled={copyPending || undefined}
        onClick={
          copied
            ? undefined
            : (event) => {
                event.stopPropagation();
                if (text) copy(text);
              }
        }
      >
        {copied ? <NativeMessageCopied /> : <NativeCommandCopy />}
      </button>
    </NativeMarkdownTooltip>
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
  exitCode: capturedExitCode,
  termination,
  cwd,
  threadId,
  turnId,
  transcriptMetadataOnly = false,
  explorationSummary,
  explorationType,
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
  const visible = useContext(TranscriptDetailVisibility);
  const detail = useCommandDetail(
    {
      threadId: threadId ?? "",
      turnId: turnId ?? "",
      itemId: commandItemId ?? "",
      expectedType: "commandExecution",
    },
    visible,
  );
  const detailRequired = transcriptMetadataOnly;
  const loaded =
    !detailRequired || (expanded && visible && detail.itemRef.current !== null);
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
  const display = normalizeNativeCommand(command);
  useLayoutEffect(() => {
    if (expanded && outputRef.current && reading) {
      outputRef.current.scrollTop = reading.top;
      outputRef.current.scrollLeft = reading.left;
    }
  }, [expanded]);
  const summary =
    termination === "unverified"
      ? `正在核对轮次状态 · ${display}`
      : t(
          `command.${stopped ? "stoppedSummary" : running ? "running" : status === "declined" ? "declinedSummary" : expanded ? "ranGeneric" : "ran"}${elapsed ? "Elapsed" : ""}`,
          {
            command: expanded ? t("command.generic") : display,
            ...(elapsed ? { elapsed } : {}),
          },
        );
  const toggle = () => {
    if (expanded) detail.clear();
    else if (detailRequired) detail.load();
    setExpanded(!expanded);
  };
  return (
    <div
      className="codex-command"
      ref={rootRef}
      data-command-id={commandItemId}
      data-command-status={
        termination === "unverified"
          ? "unverified"
          : running
            ? "inProgress"
            : status
      }
    >
      {explorationSummary ? (
        <div
          className="codex-exploration"
          data-command-action={explorationType}
        >
          <span className="codex-exploration-label">{explorationSummary}</span>
          <button
            type="button"
            className="codex-exploration-output"
            aria-label={t(
              expanded ? "command.hideOutput" : "command.showOutput",
            )}
            title={t(expanded ? "command.hideOutput" : "command.showOutput")}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={toggle}
          >
            <NativeCommandChevron data-expanded={expanded} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="codex-command-summary"
          aria-label={summary}
          aria-expanded={expanded}
          aria-controls={bodyId}
          title={command}
          onClick={toggle}
        >
          <span className="codex-command-summary-content">
            <NativeCommandTerminal className="codex-command-terminal" />
            <span className="codex-command-summary-label">{summary}</span>
          </span>
          <NativeCommandChevron
            className="codex-command-chevron"
            data-expanded={expanded}
          />
        </button>
      )}
      {expanded && (
        <div
          id={bodyId}
          className="codex-command-body"
          data-testid="exec-shell-body"
        >
          <ShellCommandBody
            key={loaded ? "loaded" : "unloaded"}
            itemRef={detail.itemRef}
            loaded={loaded}
            load={detail.load}
            phase={detail.state.phase}
            legacy={{
              command,
              aggregatedOutput,
              cwd,
              exitCode: capturedExitCode,
              status,
            }}
            stopped={stopped}
            termination={termination}
            fullCommand={fullCommand}
            setFullCommand={setFullCommand}
            outputRef={outputRef}
            setReading={setReading}
          />
        </div>
      )}
    </div>
  );
}

// Only this removable child creates body-bearing React elements. Its parent and
// summary callbacks hold a clearable local ref, never full-text element props.
function ShellCommandBody({
  itemRef,
  loaded,
  load,
  phase,
  legacy,
  stopped,
  termination,
  fullCommand,
  setFullCommand,
  outputRef,
  setReading,
}: {
  itemRef: RefObject<CommandDetailItem | null>;
  loaded: boolean;
  load: () => void;
  phase: ReturnType<typeof useCommandDetail>["state"]["phase"];
  legacy: Pick<
    ShellCommandProps,
    "command" | "aggregatedOutput" | "cwd" | "exitCode" | "status"
  >;
  stopped: boolean;
  termination: ShellCommandProps["termination"];
  fullCommand: boolean;
  setFullCommand: Dispatch<SetStateAction<boolean>>;
  outputRef: RefObject<HTMLDivElement | null>;
  setReading: Dispatch<SetStateAction<{ top: number; left: number } | null>>;
}) {
  const { t } = useTranslation("thread");
  const selected = loaded ? itemRef.current : null;
  const nativeCommand = selected?.command ?? legacy.command;
  const nativeOutput = selected
    ? selected.aggregatedOutput
    : legacy.aggregatedOutput;
  const exitCode = selected ? selected.exitCode : legacy.exitCode;
  const cwd = selected?.cwd ?? legacy.cwd;
  const outputRunning =
    !termination &&
    (selected
      ? selected.status === "inProgress"
      : legacy.status === "inProgress");
  const display = useMemo(
    () => normalizeNativeCommand(nativeCommand),
    [nativeCommand],
  );
  const shell = nativeShellName(nativeCommand) ?? t("command.shell");
  const output = !loaded
    ? ""
    : selected && nativeOutput === null
      ? t("command.detail.missingOutput")
      : nativeOutput && /\S/.test(nativeOutput)
        ? nativeOutput
        : outputRunning
          ? ""
          : t("command.noOutput");
  const tokens = useMemo(
    () => (loaded ? ansiSegments(output) : []),
    [loaded, output],
  );
  return (
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
        {loaded && (
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
            {!loaded ? (
              <div role="status">
                {t(`command.detail.${phase}`)}
                {phase !== "loading" && (
                  <button type="button" data-command-detail-load onClick={load}>
                    {t(
                      phase === "unloaded"
                        ? "command.detail.load"
                        : "command.detail.retry",
                    )}
                  </button>
                )}
              </div>
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
        {loaded && (
          <CommandCopy
            text={nativeOutput ?? ""}
            label={t("command.copyOutput")}
          />
        )}
      </div>
      <div className="codex-command-footer" aria-live="polite">
        {selected && (
          <span>
            {t(
              selected.status === "inProgress"
                ? "command.detail.activeSnapshot"
                : "command.detail.snapshot",
            )}
          </span>
        )}
        {!outputRunning &&
          (loaded ||
            exitCode != null ||
            stopped ||
            legacy.status === "declined") && (
            <span>
              {stopped ? (
                t("command.stopped")
              ) : (selected?.status ?? legacy.status) === "declined" ? (
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
  );
}
