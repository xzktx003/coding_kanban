import { useEffect, useRef } from "react";
import { reviewOwnerKey, useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
import { useEditorStore, useLayoutStore } from "@session/stores";
import { getDiffViewerProps } from "@session/components/codex/items/fileChangeLogic";
import { toRelativePath } from "@session/components/codex/items/fileChangeUtils";
import { resolveLiteralFilePath } from "@session/components/codex/presentation/fileReference";
import { nativeDiffLines } from "@session/features/nativeDiffLines";
import { NativeReviewFileDiff } from "./NativeReviewFileDiff";
import { SavedPatchAction } from "./SavedPatchAction";
import { NativeReviewFindings } from "./NativeReviewFindings";

/** Saved transcript patches are read-only data. Viewing never queries current
 * Git or changes the active thread/project; mutations use native receipts. */
export function SavedTurnDiffPanel() {
  const target = useSavedTurnReviewStore((s) => s.target);
  const findingItems = useSavedTurnReviewStore(s => target ? s.findingItems[reviewOwnerKey(target)] : undefined);
  const { diffSplitMode, setDiffSplitMode } = useLayoutStore();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = [
      ...(container.current?.querySelectorAll<HTMLElement>(
        "[data-review-path]",
      ) ?? []),
    ].find((el) => el.dataset.reviewPath === target?.selectedPath);
    card?.scrollIntoView?.({ block: "nearest" });
  }, [target]);
  if (!target) return null;
  const { threadId, turnId, cwd, changes, batches, source } = target;
  const findings = [...new Map(Object.values(findingItems ?? {}).flat().map(finding => [finding.id, finding])).values()];
  const unavailableFindings = findings.filter(finding => !changes.some(change => resolveLiteralFilePath(change.path, cwd) === finding.path && nativeDiffLines("", "", change.diff).some(row => row.lineNumber.new === finding.end)));
  const totals = changes.reduce(
    (acc, c) => ({
      added: acc.added + c.addedCount,
      removed: acc.removed + c.removedCount,
    }),
    { added: 0, removed: 0 },
  );
  return (
    <section
      ref={container}
      className="codex-presentation codex-saved-review"
      role="region"
      aria-label={source ? "Git 审查快照" : "保存的轮次变更"}
      data-owner-thread={threadId}
      data-owner-turn={turnId}
    >
      <header className="codex-saved-review-header">
        <div className="codex-saved-review-title">
          <strong>{source ? "Git 审查快照" : "本轮变更"}</strong>
          <span>{changes.length} 个文件</span>
          <span className="codex-change-added">+{totals.added}</span>
          <span className="codex-change-removed">−{totals.removed}</span>
        </div>
        <button
          type="button"
          aria-label="查看当前工作区变更"
          onClick={() => useSavedTurnReviewStore.getState().close()}
        >
          工作区变更
        </button>
        <div
          className="codex-saved-review-source"
          title={`项目：${cwd ?? "未确认"}\n轮次：${turnId}`}
        >
          <span>
            {cwd?.split("/").filter(Boolean).at(-1) ?? "项目尚未核实"}
          </span>
          <span>{source ? "只读快照" : "已保存"}</span>
        </div>
        <div className="codex-saved-review-actions">
          <button
            type="button"
            aria-pressed={diffSplitMode}
            onClick={() => setDiffSplitMode(!diffSplitMode)}
          >
            {diffSplitMode ? "统一视图" : "并排视图"}
          </button>
          {!source && <SavedPatchAction
            threadId={threadId}
            turnId={turnId}
            cwd={cwd}
            batches={batches}
          />}
        </div>
      </header>
      {source && <div className="codex-review-snapshot-provenance">
        <p>{source.scope.target.type === "baseBranch" ? `基准分支 ${source.scope.target.branch}：共同祖先 → HEAD（已提交变更）` : source.scope.target.type === "commit" ? `提交 ${source.snapshot.resolved.commit?.slice(0, 12)}：父提交 → 此提交` : "未提交变更：HEAD → 读取时的工作区（包含暂存与未暂存）"}</p>
        <p>读取时间：{source.snapshot.capturedAt}。这是读取时的 Git 快照；审查期间文件可能已改变，意见坐标需结合此快照核对。</p>
        <details><summary>快照身份与范围</summary><code>{source.snapshot.digest}</code><p>项目：{source.snapshot.cwd}<br/>请求会话：{source.scope.requestThreadId}<br/>审查会话：{threadId}<br/>轮次：{turnId}</p></details>
        {source.snapshot.omitted.length > 0 && <details><summary>{source.snapshot.omitted.length} 个文件未生成文本 Diff</summary>{source.snapshot.omitted.map(file => <p key={file.path}>{file.path}：{file.reason}</p>)}</details>}
      </div>}
      {unavailableFindings.length > 0 && <div className="codex-review-unmapped-findings"><p>以下意见的行号未出现在此快照的变更块内。</p><NativeReviewFindings findings={unavailableFindings} threadId={threadId} turnId={turnId} cwd={cwd} showScope={false}/></div>}
      {!changes.length && <p className="codex-review-selection-summary">此范围没有可显示的文件变更。</p>}
      <div className="codex-saved-review-files">
        {changes.map((change) => {
          const displayPath = toRelativePath(change.path, cwd);
          const openFile = (location?: { side: "old" | "new"; line: number }) => {
            const filePath = resolveLiteralFilePath(
              change.kind.type === "update"
                ? (change.kind.move_path ?? change.path)
                : change.path,
              cwd,
            );
            if (!filePath || !cwd) return;
            const line = nativeDiffLines("", "", change.diff).find(
              (row) => !row.separator,
            )?.lineNumber;
            useEditorStore
              .getState()
              .revealFile(filePath, cwd, location?.line ?? line?.new ?? line?.old ?? 1);
            useLayoutStore.getState().setActiveRightPanelTab("files");
          };
          return (
            <article key={change.path} data-review-path={change.path}>
              <NativeReviewFileDiff
                owner={{ threadId, turnId, cwd }}
                feedbackKey={source ? JSON.stringify([reviewOwnerKey(target), "git-review", source.snapshot.digest]) : undefined}
                path={change.path}
                findings={findings.filter(finding => resolveLiteralFilePath(change.path, cwd) === finding.path)}
                native
                {...getDiffViewerProps(change)}
                displayPath={displayPath}
                isCollapsed={false}
                split={diffSplitMode}
                onOpenFile={cwd && change.kind.type !== "delete" ? () => openFile() : undefined}
                onOpenLine={cwd && change.kind.type !== "delete" ? openFile : undefined}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
