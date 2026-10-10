import { useEffect, useMemo, useRef, useState } from "react";
import { NativeDiffContent } from "@session/features/NativeDiffContent";
import { nativeDiffLines } from "@session/features/nativeDiffLines";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import { useEditorStore, useLayoutStore } from "@session/stores";
import { resolveLiteralFilePath } from "@session/components/codex/presentation/fileReference";
import { gitHunkRead, gitHunkAction, type GitHunkSnapshot } from "./gitHunkService";
import { NativeReviewRevertIcon, NativeReviewStageIcon } from "./NativeReviewIcons";

export function NativeGitHunkReview({ cwd, filePath, staged, split = false, wrap = false, refreshKey = 0, onRefresh }: {
  cwd: string; filePath: string; staged: boolean; split?: boolean; wrap?: boolean; refreshKey?: number; onRefresh: () => void;
}) {
  const identity = JSON.stringify([cwd, filePath, staged]), owner = useRef(identity);
  owner.current = identity;
  const pendingScopes = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<GitHunkSnapshot | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [confirm, setConfirm] = useState<number | null>(null), [readVersion, setReadVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setSnapshot(null); setError(null); setBusy(false); setConfirm(null);
    gitHunkRead({ cwd, filePath, staged }).then(data => { if (active) { setSnapshot(data); setUncertain(false); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [cwd, filePath, staged, refreshKey, readVersion]);
  const lines = useMemo(() => nativeDiffLines("", "", snapshot?.unifiedDiff), [snapshot]);
  const run = async (hunkIndex: number, action: "stage" | "unstage" | "revert") => {
    if (!snapshot || busy || uncertain || pendingScopes.current.has(identity)) return;
    const captured = identity;
    pendingScopes.current.add(captured);
    setBusy(true); setError(null);
    try {
      await gitHunkAction({ cwd, filePath, staged, hunkIndex, expectedDigest: snapshot.digest, action, ...(action === "revert" ? { confirmRevert: true } : {}) });
      if (owner.current !== captured) return;
      setReadVersion(version => version + 1);
      onRefresh();
    } catch (reason) {
      if (owner.current !== captured) return;
      const unknown = !(reason instanceof SessionApiError) || reason.status >= 500;
      setUncertain(unknown);
      setError(`${unknown ? "操作回执不明，请只读刷新并核对，勿重复提交。" : "操作未完成，请核对变更后重试。"}${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { pendingScopes.current.delete(captured); if (owner.current === captured) { setBusy(false); setConfirm(null); } }
  };
  const hunk = confirm !== null ? snapshot?.hunks[confirm] : null;
  return <div className="codex-presentation codex-workspace-hunk-review" data-owner-cwd={cwd} data-owner-path={filePath}>
    {error && <div role="alert" className="codex-hunk-confirm"><p>{error}</p><button type="button" disabled={busy} onClick={() => setReadVersion(version => version + 1)}>只读刷新并核对</button></div>}
    {!snapshot && !error && <p role="status" className="codex-review-selection-summary">正在读取 Git 变更块…</p>}
    {snapshot?.binary && <p className="codex-review-selection-summary">二进制文件不显示文本变更块</p>}
    {snapshot && !snapshot.binary && !snapshot.hunks.length && <p className="codex-review-selection-summary">没有文本变更块；文件模式和重命名使用文件操作。</p>}
    {hunk && <section role="alertdialog" aria-label="确认丢弃变更块" className="codex-hunk-confirm"><p>确认丢弃 {resolveLiteralFilePath(filePath, cwd)} 的变更块 {hunk.index + 1}？范围：新文件 {hunk.newStart}–{hunk.newStart + Math.max(0, hunk.newCount - 1)} 行，旧文件 {hunk.oldStart}–{hunk.oldStart + Math.max(0, hunk.oldCount - 1)} 行。{staged ? "将同时修改暂存区与工作区；存在未暂存冲突时拒绝执行。" : "只修改此块对应的工作区内容。"}</p><button type="button" disabled={busy} onClick={() => void run(hunk.index, "revert")}>确认丢弃此块</button><button type="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button></section>}
    {snapshot && !snapshot.binary && <NativeDiffContent path={filePath} lines={lines} split={split} wrap={wrap} hunkPresentation="line-info" onOpenLine={({ line }) => {
      const path = resolveLiteralFilePath(filePath, cwd); if (!path) return;
      useEditorStore.getState().revealFile(path, cwd, line);
      useLayoutStore.getState().setActiveRightPanelTab("files");
    }} renderHunkActions={index => <div className="codex-hunk-actions"><button type="button" disabled={busy || uncertain} aria-label={`还原变更块 ${index + 1}`} title="还原" onClick={() => setConfirm(index)}><NativeReviewRevertIcon/></button><button type="button" disabled={busy || uncertain} aria-label={`${staged ? "取消暂存" : "暂存"}变更块 ${index + 1}`} title={staged ? "取消暂存" : "暂存"} onClick={() => void run(index, staged ? "unstage" : "stage")}><NativeReviewStageIcon unstage={staged}/></button></div>} />}
  </div>;
}
