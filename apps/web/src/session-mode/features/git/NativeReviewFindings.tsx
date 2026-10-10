import { useEffect, useRef, useState } from "react";
import { useEditorStore, useLayoutStore } from "@session/stores";
import { appendDraft, sessionDraftKey } from "@session/stores/useSessionDraftStore";
import type { NativeReviewFinding } from "./nativeReviewFindings";
import { reviewOwnerKey, useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
import { readGitReviewSnapshot } from "./gitReviewService";
import { splitNativePatchFiles } from "@session/features/nativePatchPaths";
import { getChangeCounts } from "@session/components/codex/items/fileChangeLogic";
import { CodexMarkdown } from "@session/components/codex/presentation/CodexMarkdown";
import { CapturedCodexContentOwner } from "@session/components/codex/presentation/ownerContext";
import "./review-native.css";

export function NativeReviewFindings({ findings, threadId, turnId, cwd, showScope = true }: {
  findings: NativeReviewFinding[]; threadId?: string; turnId?: string; cwd?: string | null; showScope?: boolean;
}) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const ownerKey = threadId && turnId ? reviewOwnerKey({ threadId, turnId, cwd }) : null;
  const scope = useSavedTurnReviewStore(state => ownerKey ? state.reviewScopes[ownerKey] : undefined);
  const currentOwner = useRef(ownerKey); currentOwner.current = ownerKey;
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { setAdded(new Set()); setError(null); setPending(false); }, [threadId, turnId, cwd]);
  if (!findings.length && (!scope || !showScope)) return null;
  return <details className="codex-review-findings" open data-owner-thread={threadId} data-owner-turn={turnId}>
    <summary>{findings.length ? `${findings.length} 条审查意见` : "审查结果 · 无审查意见"}</summary>
    {scope && showScope && <div className="codex-review-snapshot-entry">
      <span>{scope.target.type === "baseBranch" ? `基准分支：${scope.target.branch}` : scope.target.type === "commit" ? `提交：${scope.target.sha.slice(0, 12)}` : scope.target.type === "custom" ? "自定义审查" : "未提交的变更"}</span>
      {scope.target.type === "custom" ? <p>自定义指令没有确定的 Git 比较范围，可从下面的文件位置查看意见。</p> : <button type="button" disabled={pending} onClick={async () => {
        if (pending) return;
        const captured = structuredClone(scope);
        setPending(true); setError(null);
        try {
          const snapshot = await readGitReviewSnapshot(captured.cwd, captured.target);
          if (currentOwner.current !== ownerKey) return;
          const changes = splitNativePatchFiles(snapshot.unifiedDiff).filter(file => file.path).map(file => {
            const kind = /^deleted file mode /m.test(file.diff) ? { type: "delete" as const } : /^new file mode /m.test(file.diff) ? { type: "add" as const } : { type: "update" as const, move_path: null };
            return { path: `${snapshot.cwd.replace(/\/$/, "")}/${file.path}`, diff: file.diff, kind, ...getChangeCounts(kind, file.diff) };
          });
          useSavedTurnReviewStore.getState().open({ threadId: captured.reviewThreadId, turnId: captured.turnId, cwd: captured.cwd, changes, batches: [], source: { type: "git-review", scope: captured, snapshot } });
          useLayoutStore.getState().setActiveRightPanelTab("diff"); useLayoutStore.getState().setRightPanelOpen(true);
        } catch (value) { setError(value instanceof Error ? value.message : "无法读取审查快照"); }
        finally { setPending(false); }
      }}>{pending ? "读取审查快照…" : "查看审查 Diff"}</button>}
      {error && <p role="alert">{error}</p>}
    </div>}
    {findings.map((finding) => <article key={finding.id} className="codex-review-finding">
      <button type="button" aria-label={`查看 ${finding.title}：${finding.path}:${finding.start}-${finding.end}`} disabled={!cwd} onClick={() => {
        if (!cwd) return;
        useEditorStore.getState().revealFile(finding.path, cwd, finding.start);
        useLayoutStore.getState().setActiveRightPanelTab("files");
        useLayoutStore.getState().setRightPanelOpen(true);
      }}><strong>{finding.title}</strong><span>{finding.path.replace(cwd ? `${cwd.replace(/\/$/, "")}/` : "", "")}:{finding.start}{finding.end !== finding.start ? `–${finding.end}` : ""}</span></button>
      <CapturedCodexContentOwner.Provider value={{ threadId, cwd }}><CodexMarkdown value={finding.body} threadId={threadId} /></CapturedCodexContentOwner.Provider>
      {threadId && <button type="button" disabled={added.has(finding.id)} onClick={() => {
        appendDraft(sessionDraftKey("codex", threadId), `\n关于审查意见（轮次 ${turnId ?? "未记录"}，${finding.path}:${finding.start}-${finding.end}）：\n${finding.title}\n${finding.body}\n`);
        setAdded((before) => new Set([...before, finding.id]));
      }}>{added.has(finding.id) ? "已加入此会话草稿" : "回复此意见"}</button>}
    </article>)}
  </details>;
}
