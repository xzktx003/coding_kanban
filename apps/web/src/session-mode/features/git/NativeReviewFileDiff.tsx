import { useEffect, useState, type ComponentProps } from "react";
import { DiffViewer } from "@session/features/DiffViewer";
import type { NativeDiffSelection } from "@session/features/nativeDiffSelection";
import { useSavedTurnReviewStore, reviewOwnerKey, reviewSelectionKey, type LocalReviewComment } from "@session/stores/useSavedTurnReviewStore";
import { appendDraft, sessionDraftKey } from "@session/stores/useSessionDraftStore";
import type { NativeReviewFinding } from "./nativeReviewFindings";
import { NativeReviewFindings } from "./NativeReviewFindings";

export function NativeReviewFileDiff({ owner, path, findings = [], feedbackKey, ...props }: {
  owner: { threadId: string; turnId: string; cwd?: string | null };
  path: string;
  findings?: NativeReviewFinding[];
  feedbackKey?: string;
} & ComponentProps<typeof DiffViewer>) {
  const key = feedbackKey ?? reviewOwnerKey(owner);
  const [selection, setSelection] = useState<NativeDiffSelection | null>(null);
  const feedback = useSavedTurnReviewStore(state => state.feedback[key]);
  useEffect(() => { setSelection(null); }, [key, path]);
  const comments = feedback?.comments.filter(comment => comment.path === path) ?? [];
  const draft = selection ? feedback?.drafts[reviewSelectionKey(path, selection)] ?? "" : "";
  const addToDraft = (comment: LocalReviewComment) => {
    const reference = `${owner.cwd?.replace(/\/$/, "") ?? ""}/${path.replace(/^\//, "")}`;
    const file = path.startsWith("/") ? path : reference;
    const fence = "`".repeat(Math.max(3, ...(comment.selection.content.match(/`+/g) ?? []).map(value => value.length + 1)));
    appendDraft(sessionDraftKey("codex", owner.threadId), `\n关于保存轮次 ${owner.turnId} 的 ${file}:${comment.selection.start}-${comment.selection.end}（${comment.selection.side === "old" ? "旧文件" : "新文件"}）：\n${comment.body}\n${fence}\n${comment.selection.content}\n${fence}\n`);
    useSavedTurnReviewStore.getState().markAddedToDraft(key, comment.id);
  };
  return <DiffViewer {...props} native presentation="review" selection={selection} onSelectLines={setSelection} renderAnnotation={location => {
    const atLine = comments.filter(comment => comment.selection.side === location.side && comment.selection.end === location.line);
    const lineFindings = findings.filter(finding => finding.side === location.side && finding.end === location.line);
    const selected = selection?.side === location.side && selection.end === location.line;
    if (!atLine.length && !lineFindings.length && !selected) return null;
    return <>
      {lineFindings.length > 0 && <div className="codex-review-comment" data-review-model-finding><NativeReviewFindings findings={lineFindings} {...owner} showScope={false} /></div>}
      {atLine.map(comment => <article className="codex-review-comment" key={comment.id} data-review-comment>
        <header><span>本地评论 · {location.side === "old" ? "L" : "R"}{comment.selection.start}{comment.selection.end !== comment.selection.start ? `–${comment.selection.end}` : ""}</span><button type="button" aria-label="删除本地评论" onClick={() => useSavedTurnReviewStore.getState().removeComment(key, comment.id)}>删除</button></header>
        <p>{comment.body}</p>
        <footer><button type="button" disabled={comment.addedToDraft} onClick={() => addToDraft(comment)}>{comment.addedToDraft ? "已加入此会话草稿" : "加入此会话草稿"}</button></footer>
      </article>)}
      {selected && selection && <section className="codex-review-comment" aria-label={`评论 ${path}:${selection.start}-${selection.end}`}>
        <header><span>评论 · {location.side === "old" ? "L" : "R"}{selection.start}{selection.end !== selection.start ? `–${selection.end}` : ""}</span><button type="button" aria-label="关闭行评论" onClick={() => setSelection(null)}>关闭</button></header>
        <textarea aria-label="行评论" placeholder="添加评论…" value={draft} onChange={event => useSavedTurnReviewStore.getState().setCommentDraft(key, path, selection, event.target.value)} />
        <footer><button type="button" disabled={!draft.trim()} onClick={() => { useSavedTurnReviewStore.getState().saveComment(key, path, selection); setSelection(null); }}>保存评论</button></footer>
      </section>}
    </>;
  }} />;
}
