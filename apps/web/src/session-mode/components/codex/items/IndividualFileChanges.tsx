import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTranscriptState } from "../thread/rowState";
import type { FileUpdateChange } from "@session/bindings/v2";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { resolveLiteralFilePath } from "../presentation/fileReference";
import { NativeCommandCopy } from "../presentation/NativeCommandIcons";
import { useEditorStore, useLayoutStore } from "@session/stores";
import { Button } from "@session/components/ui/button";
import { DiffViewer } from "@session/features/DiffViewer";
import { getFilename } from "@session/utils/getFilename";
import type { DiffViewerInput } from "./fileChangeLogic";
import { isTranscriptMetadataOnly } from "../presentation/transcriptMetadata";
import { TranscriptDetailsNotice } from "./TranscriptDetailsNotice";
import { useNativeCopyFeedback } from "../presentation/useNativeCopyFeedback";
import "@session/features/git/review-native.css";

type IndividualFileChangesProps = {
  changes: FileUpdateChange[];
  fileChangeMap: Record<FileUpdateChange["kind"]["type"], string>;
  getChangeCounts: (
    kind: FileUpdateChange["kind"],
    diff: string,
  ) => {
    addedCount: number;
    removedCount: number;
  };
  getDiffViewerProps: (change: {
    path: string;
    kind: FileUpdateChange["kind"];
    diff: string;
  }) => DiffViewerInput;
};

function ChatFileDiffCard({
  path,
  addedCount,
  removedCount,
  diff,
  viewer,
  onOpenLine,
}: {
  path: string;
  addedCount: number;
  removedCount: number;
  diff: string;
  viewer: DiffViewerInput;
  onOpenLine?: (location: { side: "old" | "new"; line: number }) => void;
}) {
  const { i18n } = useTranslation();
  const { copied, copyPending, copy } = useNativeCopyFeedback([path, diff], {
    feedbackMs: 1500,
    language: i18n?.language ?? "zh",
  });
  const fileName = getFilename(path);
  return (
    <div className="codex-chat-file-diff">
      <header className="codex-chat-file-diff-header">
        <span className="codex-chat-file-diff-title">
          <button
            type="button"
            className="codex-chat-file-diff-path"
            title={path}
            disabled={!onOpenLine}
            onClick={() => onOpenLine?.({ side: "new", line: 1 })}
          >
            {fileName}
          </button>
          <span className="codex-chat-file-diff-stats">
            <span data-kind="add">+{addedCount}</span>
            <span data-kind="remove">-{removedCount}</span>
          </span>
        </span>
        <button
          type="button"
          className="codex-chat-file-diff-copy"
          aria-label="Copy"
          title={copied ? "Copied!" : "Copy"}
          disabled={copied}
          aria-busy={copyPending || undefined}
          aria-disabled={copyPending || undefined}
          onClick={() => copy(diff)}
        >
          <NativeCommandCopy width="16" height="16" />
        </button>
      </header>
      <div className="codex-chat-file-diff-body">
        <DiffViewer
          native
          presentation="inline"
          {...viewer}
          displayPath={path}
          isCollapsed={false}
          onOpenLine={onOpenLine}
        />
      </div>
    </div>
  );
}

export const IndividualFileChanges = ({
  changes,
  fileChangeMap,
  getChangeCounts,
  getDiffViewerProps,
}: IndividualFileChangesProps) => {
  const owner = useCodexContentOwner();
  const [expandedKeys, setExpandedKeys] = useTranscriptState(
    "files",
    new Set<string>(),
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div>
      {changes.map((change, index) => {
        const metadataOnly = isTranscriptMetadataOnly(change);
        const filePath =
          owner.threadId && owner.cwd
            ? resolveLiteralFilePath(
                change.kind.type === "update"
                  ? (change.kind.move_path ?? change.path)
                  : change.path,
                owner.cwd,
              )
            : null;
        const openFile = (line?: number) => {
          if (!filePath || !owner.cwd || change.kind.type === "delete") return;
          useEditorStore.getState().revealFile(filePath, owner.cwd, line);
          useLayoutStore.getState().setActiveRightPanelTab("files");
          useLayoutStore.getState().setRightPanelOpen(true);
        };
        const key = `${change.path}-${index}`;
        const isExpanded = expandedKeys.has(key);
        const { addedCount, removedCount } = metadataOnly
          ? { addedCount: 0, removedCount: 0 }
          : getChangeCounts(change.kind, change.diff);

        return (
          <div key={key}>
            <div className="group codex-individual-file-change-row">
              <Button
                variant="ghost"
                className="codex-individual-file-change-label"
                onClick={() => toggleExpanded(key)}
                disabled={metadataOnly}
              >
                {fileChangeMap[change.kind.type]}
              </Button>
              <span className="w-fit shrink-0">
                <button
                  type="button"
                  className="codex-file-link"
                  disabled={!filePath || change.kind.type === "delete"}
                  title={change.path}
                  onClick={() => openFile()}
                >
                  {getFilename(change.path)}
                </button>
              </span>
              {metadataOnly ? (
                <TranscriptDetailsNotice />
              ) : (
                <span className="codex-individual-file-change-stats">
                  <span data-kind="add">+{addedCount}</span>
                  <span data-kind="remove">-{removedCount}</span>
                </span>
              )}
              <Button
                className="codex-individual-file-disclosure"
                size="icon"
                aria-label={`展开或收起 ${getFilename(change.path)} Diff`}
                aria-expanded={isExpanded}
                disabled={metadataOnly}
                variant="ghost"
                onClick={() => toggleExpanded(key)}
              >
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              </Button>
            </div>
            {isExpanded && !metadataOnly && (
              <ChatFileDiffCard
                key={JSON.stringify([owner.threadId, owner.cwd, change.path])}
                path={change.path}
                addedCount={addedCount}
                removedCount={removedCount}
                diff={change.diff}
                viewer={getDiffViewerProps(change)}
                onOpenLine={
                  filePath && change.kind.type !== "delete"
                    ? ({ line }) => openFile(line)
                    : undefined
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
