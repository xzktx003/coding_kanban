import { Trans, useTranslation } from "react-i18next";
import type { CommandAction } from "@session/bindings/v2";
import { getFilename } from "@session/utils/getFilename";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { resolveLiteralFilePath } from "../presentation/fileReference";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { ShellCommand } from "./ShellCommand";
import type { CommandActionSource } from "../thread/deriveRenderItems";

export const CommandActionItem = ({
  action,
  commandItemId,
  aggregatedOutput,
  status,
  durationMs,
  startedAtMs,
  termination,
  cwd,
  threadId,
  turnId,
  exitCode,
}: {
  action: CommandAction;
  commandItemId?: string | null;
  aggregatedOutput?: string | null;
  status?: CommandActionSource["status"];
  durationMs?: CommandActionSource["durationMs"];
  startedAtMs?: CommandActionSource["startedAtMs"];
  termination?: CommandActionSource["termination"];
  cwd?: string;
  threadId?: string;
  turnId?: string;
  exitCode?: number | null;
}) => {
  const { t } = useTranslation("thread");
  const owner = useCodexContentOwner(threadId);
  const root = cwd ?? owner.cwd;

  if (
    action.type === "unknown" ||
    status === "failed" ||
    status === "declined" ||
    termination
  ) {
    return (
      <ShellCommand
        command={action.command}
        commandItemId={commandItemId}
        aggregatedOutput={aggregatedOutput}
        status={status}
        durationMs={durationMs}
        startedAtMs={startedAtMs}
        termination={termination}
        cwd={cwd}
        threadId={threadId}
        turnId={turnId}
        exitCode={exitCode}
      />
    );
  }

  // Native exploration rows are emitted after completion; the active activity
  // header presents the pending action. Never turn an unfinished read into "Read".
  if (status !== "completed") return null;
  const path = action.path;
  const file =
    action.type === "read" && path ? resolveLiteralFilePath(path, root) : null;
  const displayPath =
    action.type === "read" ? getFilename(action.name || path || "") : path;
  const key =
    action.type === "read"
      ? "read"
      : action.type === "listFiles"
        ? path
          ? "listedPath"
          : "listed"
        : action.query
          ? path
            ? "searchedQueryPath"
            : "searchedQuery"
          : "searched";
  const components = {
    verb: <span className="codex-exploration-verb" />,
    query: <span>{action.type === "search" ? action.query : ""}</span>,
    path: file ? (
      <a
        className="codex-activity-file-link"
        data-agent-activity-file-link=""
        href="#"
        title={file}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          useEditorStore.getState().revealFile(file, root ?? undefined);
          const layout = useLayoutStore.getState();
          layout.setActiveRightPanelTab("files");
          layout.setRightPanelOpen(true);
        }}
      >
        {displayPath}
      </a>
    ) : (
      <span>{displayPath}</span>
    ),
  };
  return (
    <div className="codex-exploration" data-command-action={action.type}>
      <span className="codex-exploration-label">
        <Trans t={t} i18nKey={`exploration.${key}`} components={components} />
      </span>
    </div>
  );
};
