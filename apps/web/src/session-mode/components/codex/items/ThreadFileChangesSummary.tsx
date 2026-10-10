import { useTranscriptInspection } from "../thread/inspection";
import { ArrowRight, Eye } from "lucide-react";
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
import type { SavedPatchBatch } from "@agent-orchestrator/shared";
import { SavedPatchAction } from "@session/features/git/SavedPatchAction";
import { useCodexContentOwner } from "../presentation/ownerContext";
import type { AggregatedFileChange } from "./fileChangeLogic";
import { getDiffViewerProps } from "./fileChangeLogic";
import { toRelativePath, useOpenReviewTab } from "./fileChangeUtils";
import { getFilename } from "@session/utils/getFilename";
import { NativeTurnDiffIcon } from "@session/features/git/NativeReviewIcons";
import "@session/features/git/review-native.css";

type ThreadFileChangesSummaryProps = {
  changes: AggregatedFileChange[];
  threadId?: string;
  turnId?: string;
  batches?: SavedPatchBatch[];
};

/**
 * Compact turn-diff summary shown inline in CodexThread. Deliberately does
 * not render per-file diffs — that's the right panel's review tab's job.
 */
export const ThreadFileChangesSummary = ({
  changes,
  threadId,
  turnId,
  batches = [],
}: ThreadFileChangesSummaryProps) => {
  const inspection = useTranscriptInspection();
  const { t } = useTranslation("thread");
  const { cwd } = useCodexContentOwner(threadId);
  const openReviewTab = useOpenReviewTab(
    threadId && turnId
      ? { threadId, turnId, cwd, changes, batches }
      : undefined,
  );
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewDismissed = useRef(false);
  const openReview = (path?: string) => {
    previewDismissed.current = true;
    setPreviewPath(null);
    openReviewTab(path);
  };
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

  if (inspection)
    return (
      <div className="session-file-changes space-y-2">
        {changes.map((change) => (
          <details key={change.path}>
            <summary className="cursor-pointer text-sm">
              {change.path} +{change.addedCount} −{change.removedCount}
            </summary>
            <DiffViewer
              native
              {...getDiffViewerProps(change)}
              displayPath={change.path}
              isCollapsed={false}
            />
          </details>
        ))}
      </div>
    );
  const totals = changes.reduce(
    (acc, change) => {
      acc.added += change.addedCount;
      acc.removed += change.removedCount;
      return acc;
    },
    { added: 0, removed: 0 },
  );

  const single = changes.length === 1 ? changes[0] : undefined;
  const stats = (added: number, removed: number) => (
    <span className="codex-turn-diff-stats">
      <span data-kind="add">+{added}</span>
      <span data-kind="remove">-{removed}</span>
    </span>
  );
  const title = single
    ? t("fileChanges.editedSingle", {
        filename: getFilename(single.path),
        defaultValue: `${t("fileChanges.edited")} ${getFilename(single.path)}`,
      })
    : t("fileChanges.editedFiles", {
        count: changes.length,
        defaultValue: t("fileChanges.changed", { count: changes.length }),
      });
  const titleContent = (
    <>
      <span className="codex-turn-diff-title-text">{title}</span>
      <span className="codex-turn-diff-subtitle">
        {stats(totals.added, totals.removed)}
      </span>
      <span className="codex-turn-diff-hover-subtitle" aria-hidden="true">
        {t("common.review")}
        <ArrowRight size={12} />
      </span>
    </>
  );
  const preview = single && (
    <HoverCardContent className="codex-file-preview w-[36rem] max-w-[80vw] p-0 overflow-hidden">
      <DiffViewer
        native
        presentation="preview"
        {...getDiffViewerProps(single)}
        displayPath={toRelativePath(single.path, cwd)}
        isCollapsed={false}
        className="max-h-96"
      />
    </HoverCardContent>
  );
  return (
    <div
      className="session-file-changes codex-turn-diff-summary"
      data-file-count={changes.length}
    >
      <div className="session-file-changes-header codex-turn-diff-header">
        <span className="codex-turn-diff-icon">
          <NativeTurnDiffIcon />
        </span>
        {single ? (
          <HoverCard
            openDelay={200}
            open={previewPath === single.path}
            onOpenChange={(open) =>
              setPreviewPath(
                open && !previewDismissed.current ? single.path : null,
              )
            }
          >
            <HoverCardTrigger asChild>
              <button
                type="button"
                className="codex-turn-diff-title"
                aria-label={toRelativePath(single.path, cwd)}
                title={toRelativePath(single.path, cwd)}
                onPointerLeave={() => {
                  previewDismissed.current = false;
                }}
                onClick={() => openReview(single.path)}
              >
                {titleContent}
              </button>
            </HoverCardTrigger>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="codex-turn-diff-preview"
              aria-label={`预览 ${toRelativePath(single.path, cwd)} Diff`}
              onClick={() => {
                previewDismissed.current = false;
                setPreviewPath((value) =>
                  value === single.path ? null : single.path,
                );
              }}
            >
              <Eye size={14} />
            </Button>
            {preview}
          </HoverCard>
        ) : (
          <button
            type="button"
            className="codex-turn-diff-title"
            onClick={() => openReview()}
          >
            {titleContent}
          </button>
        )}
        <div className="codex-turn-diff-actions">
          <SavedPatchAction
            threadId={threadId}
            turnId={turnId}
            cwd={cwd}
            batches={batches}
            disabled={Boolean(inspection)}
          />
          <Button
            variant="outline"
            size="sm"
            className="codex-turn-diff-review"
            onClick={() => openReview(single?.path)}
          >
            {t("common.review")}
          </Button>
        </div>
      </div>

      {!single && (
        <div
          ref={listRef}
          role="region"
          aria-label={t("fileChanges.listLabel")}
          tabIndex={scrollable ? 0 : -1}
          data-scrollable={scrollable}
          className="session-file-changes-list"
          onScroll={updateScrollEnd}
        >
          {changes.map((change) => (
            <div
              key={change.path}
              className="session-file-change-row codex-turn-diff-file-row"
            >
              <HoverCard
                openDelay={200}
                open={previewPath === change.path}
                onOpenChange={(open) =>
                  setPreviewPath(
                    open && !previewDismissed.current ? change.path : null,
                  )
                }
              >
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    onPointerLeave={() => {
                      previewDismissed.current = false;
                    }}
                    onClick={() => openReview(change.path)}
                    className="flex-1 min-w-0 text-left"
                    title={toRelativePath(change.path, cwd)}
                  >
                    <span className="font-mono truncate block">
                      {toRelativePath(change.path, cwd)}
                    </span>
                  </button>
                </HoverCardTrigger>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`预览 ${toRelativePath(change.path, cwd)} Diff`}
                  onClick={() => {
                    previewDismissed.current = false;
                    setPreviewPath((value) =>
                      value === change.path ? null : change.path,
                    );
                  }}
                >
                  <Eye size={14} />
                </Button>
                <HoverCardContent className="codex-file-preview w-[36rem] max-w-[80vw] p-0 overflow-hidden">
                  <DiffViewer
                    native
                    presentation="preview"
                    {...getDiffViewerProps(change)}
                    displayPath={toRelativePath(change.path, cwd)}
                    isCollapsed={false}
                    className="max-h-96"
                  />
                </HoverCardContent>
              </HoverCard>
              {stats(change.addedCount, change.removedCount)}
              <SavedPatchAction
                threadId={threadId}
                turnId={turnId}
                cwd={cwd}
                batches={batches}
                filePath={
                  batches
                    .flatMap((b) => b.changes)
                    .find(
                      (c) =>
                        c.path === change.path ||
                        toRelativePath(c.path, cwd) ===
                          toRelativePath(change.path, cwd),
                    )?.path
                }
                compact
                disabled={
                  Boolean(inspection) ||
                  !batches.some((b) =>
                    b.changes.some(
                      (c) =>
                        c.path === change.path ||
                        toRelativePath(c.path, cwd) ===
                          toRelativePath(change.path, cwd),
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
      {!single && scrollable && (
        <div className="session-file-changes-hint" data-at-end={atEnd}>
          {t(atEnd ? "fileChanges.scrollEnd" : "fileChanges.scrollMore")}
        </div>
      )}
    </div>
  );
};
