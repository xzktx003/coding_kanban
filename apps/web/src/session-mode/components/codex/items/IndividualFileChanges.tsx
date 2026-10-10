import { ChevronRight } from "lucide-react";
import { useTranscriptState } from "../thread/rowState";
import type { FileUpdateChange } from "@session/bindings/v2";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { resolveLiteralFilePath } from "../presentation/fileReference";
import { useEditorStore, useLayoutStore } from "@session/stores";
import { Button } from "@session/components/ui/button";
import { DiffViewer } from "@session/features/DiffViewer";
import { getFilename } from "@session/utils/getFilename";
import type { DiffViewerInput } from "./fileChangeLogic";
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
        const { addedCount, removedCount } = getChangeCounts(
          change.kind,
          change.diff,
        );

        return (
          <div key={key}>
            <div className="group codex-individual-file-change-row">
              <Button
                variant="ghost"
                className="codex-individual-file-change-label"
                onClick={() => toggleExpanded(key)}
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
              <span className="codex-individual-file-change-stats">
                <span data-kind="add">+{addedCount}</span>
                <span data-kind="remove">-{removedCount}</span>
              </span>
              <Button
                className="codex-individual-file-disclosure"
                size="icon"
                aria-label={`展开或收起 ${getFilename(change.path)} Diff`}
                aria-expanded={isExpanded}
                variant="ghost"
                onClick={() => toggleExpanded(key)}
              >
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              </Button>
            </div>
            {isExpanded && (
              <DiffViewer
                native
                presentation="inline"
                {...getDiffViewerProps(change)}
                displayPath={change.path}
                isCollapsed={false}
                className="mt-2 max-h-64"
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
