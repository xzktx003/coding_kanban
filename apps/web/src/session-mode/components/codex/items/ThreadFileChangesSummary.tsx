import { useTranscriptInspection } from "../thread/inspection";
import { Diff, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { Button } from "@session/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@session/components/ui/hover-card";
import { DiffViewer } from "@session/features/DiffViewer";
import { gitReverseFiles } from "@session/services/apiAdapt";
import { useEditorStore, useWorkspaceStore } from "@session/stores";
import type { AggregatedFileChange } from "./fileChangeLogic";
import { getDiffViewerProps } from "./fileChangeLogic";
import { toRelativePath, useOpenReviewTab } from "./fileChangeUtils";

type ThreadFileChangesSummaryProps = {
  changes: AggregatedFileChange[];
};

type PendingUndo = { kind: "all" } | { kind: "file"; path: string };

/**
 * Compact turn-diff summary shown inline in CodexThread. Deliberately does
 * not render per-file diffs — that's the right panel's review tab's job.
 */
export const ThreadFileChangesSummary = ({
  changes,
}: ThreadFileChangesSummaryProps) => {
  const inspection = useTranscriptInspection();
  const { t } = useTranslation("thread");
  const { cwd } = useWorkspaceStore();
  const { hasConfirmedGitRevert, setHasConfirmedGitRevert } = useEditorStore();
  const openReviewTab = useOpenReviewTab();
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [undoing, setUndoing] = useState(false);
  const mobile = useIsMobile();
  const scrollable = changes.length > (mobile ? 4 : 6);
  const listRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const updateScrollEnd = () => {
    const list = listRef.current;
    if (list)
      setAtEnd(
        list.clientHeight > 0 &&
          list.scrollHeight - list.scrollTop - list.clientHeight <= 1,
      );
  };
  useLayoutEffect(() => {
    updateScrollEnd();
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(updateScrollEnd);
    observer.observe(list);
    return () => observer.disconnect();
  }, [changes.length, mobile]);

  if (changes.length === 0) return null;

  if (inspection) return <div className="session-file-changes space-y-2">{changes.map(change => <details key={change.path}><summary className="cursor-pointer text-sm">{change.path} +{change.addedCount} −{change.removedCount}</summary><DiffViewer {...getDiffViewerProps(change)} displayPath={change.path} isCollapsed={false} /></details>)}</div>;
  const totals = changes.reduce(
    (acc, change) => {
      acc.added += change.addedCount;
      acc.removed += change.removedCount;
      return acc;
    },
    { added: 0, removed: 0 },
  );

  const doUndo = async (target: PendingUndo) => {
    if (!cwd) return;
    const paths =
      target.kind === "all"
        ? changes.map((change) => change.path)
        : [target.path];
    setUndoing(true);
    try {
      await gitReverseFiles(cwd, paths, false);
    } finally {
      setUndoing(false);
      setPendingUndo(null);
    }
  };

  const requestUndo = (target: PendingUndo) => {
    if (!hasConfirmedGitRevert) {
      setPendingUndo(target);
      return;
    }
    void doUndo(target);
  };

  return (
    <div className="session-file-changes space-y-1 border rounded-md p-3">
      <div className="session-file-changes-header flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">
          {t("fileChanges.changed", { count: changes.length })}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 gap-1.5"
            onClick={() => requestUndo({ kind: "all" })}
            disabled={undoing || inspection}
            title={t("fileChanges.undoAllTitle")}
          >
            <Undo2 className="h-3 w-3" />
            {t("fileChanges.undoAll")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 gap-1.5"
            onClick={openReviewTab}
          >
            <Diff className="h-3 w-3" />
            {t("common.review")}
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-green-600 dark:text-green-400">
                +{totals.added}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{totals.removed}
              </span>
            </span>
          </Button>
        </div>
      </div>

      {pendingUndo && (
        <div className="flex items-center gap-2 rounded-sm bg-destructive/10 px-2 py-1.5 text-xs">
          <span className="flex-1 text-destructive">
            {pendingUndo.kind === "all"
              ? t("fileChanges.confirmUndoAll", { count: changes.length })
              : t("fileChanges.confirmUndoFile", {
                  path: toRelativePath(pendingUndo.path, cwd),
                })}
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setHasConfirmedGitRevert(true);
              void doUndo(pendingUndo);
            }}
          >
            {t("common.undo")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setPendingUndo(null)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}

      <div
        ref={listRef}
        role="region"
        aria-label={t("fileChanges.listLabel")}
        tabIndex={scrollable ? 0 : -1}
        data-scrollable={scrollable}
        className="session-file-changes-list divide-y"
        onScroll={updateScrollEnd}
      >
        {changes.map((change) => (
          <div
            key={change.path}
            className="session-file-change-row flex w-full items-center justify-between gap-3 text-sm hover:bg-muted/50 rounded-sm px-1"
          >
            <HoverCard openDelay={200}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  onClick={openReviewTab}
                  className="flex-1 min-w-0 text-left"
                  title={toRelativePath(change.path, cwd)}
                >
                  <span className="font-mono truncate block">
                    {toRelativePath(change.path, cwd)}
                  </span>
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-[36rem] max-w-[80vw] p-0 overflow-hidden">
                <DiffViewer
                  {...getDiffViewerProps(change)}
                  displayPath={toRelativePath(change.path, cwd)}
                  isCollapsed={false}
                  className="max-h-96"
                />
              </HoverCardContent>
            </HoverCard>
            <span className="flex items-center gap-2 text-xs shrink-0">
              <span className="text-green-600 dark:text-green-400">
                +{change.addedCount}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{change.removedCount}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={() => requestUndo({ kind: "file", path: change.path })}
              disabled={undoing || inspection}
              title={t("fileChanges.undoFileTitle")}
            >
              <Undo2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      {scrollable && (
        <div className="session-file-changes-hint" data-at-end={atEnd}>
          {t(atEnd ? "fileChanges.scrollEnd" : "fileChanges.scrollMore")}
        </div>
      )}
    </div>
  );
};
