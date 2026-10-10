import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SavedPatchBatch } from "@agent-orchestrator/shared";
import type { AggregatedFileChange } from "@session/components/codex/items/fileChangeLogic";
import type { NativeDiffSelection } from "@session/features/nativeDiffSelection";
import type { ReviewTarget } from "@session/bindings/v2";
import type { NativeReviewFinding } from "@session/features/git/nativeReviewFindings";
import type { GitReviewSnapshot } from "@session/features/git/gitReviewService";
export interface CapturedReviewScope { requestThreadId: string; reviewThreadId: string; turnId: string; cwd: string; target: ReviewTarget }
export interface FindingProjection { threadId: string; turnId: string; itemId: string; cwd?: string | null; findings: NativeReviewFinding[] }
export const reviewOwnerKey = (owner: { threadId: string; turnId: string; cwd?: string | null }) => JSON.stringify([owner.threadId, owner.turnId, owner.cwd ?? null]);
export const reviewSelectionKey = (path: string, selection: NativeDiffSelection) => JSON.stringify([path, selection.side, selection.start, selection.end]);
export interface LocalReviewComment { id: string; path: string; selection: NativeDiffSelection; body: string; addedToDraft?: boolean }
export interface SavedTurnReview {
  threadId: string;
  turnId: string;
  cwd?: string | null;
  changes: AggregatedFileChange[];
  batches: SavedPatchBatch[];
  selectedPath?: string;
  source?: { type: "git-review"; scope: CapturedReviewScope; snapshot: GitReviewSnapshot };
}
export const useSavedTurnReviewStore = create<{
  target: SavedTurnReview | null;
  open: (target: SavedTurnReview, path?: string) => void;
  close: () => void;
  feedback: Record<string, { drafts: Record<string, string>; comments: LocalReviewComment[] }>;
  reviewScopes: Record<string, CapturedReviewScope>;
  findingItems: Record<string, Record<string, NativeReviewFinding[]>>;
  captureReviewScope: (scope: CapturedReviewScope) => void;
  projectFindings: (projection: FindingProjection) => void;
  setCommentDraft: (owner: string, path: string, selection: NativeDiffSelection, text: string) => void;
  saveComment: (owner: string, path: string, selection: NativeDiffSelection) => void;
  removeComment: (owner: string, id: string) => void;
  markAddedToDraft: (owner: string, id: string) => void;
}>()(persist((set) => ({
  target: null,
  feedback: {},
  reviewScopes: {},
  findingItems: {},
  captureReviewScope: (scope) => set(state => ({ reviewScopes: { ...state.reviewScopes, [reviewOwnerKey({ threadId: scope.reviewThreadId, turnId: scope.turnId, cwd: scope.cwd })]: structuredClone(scope) } })),
  projectFindings: ({ itemId, findings, ...owner }) => set(state => {
    const key = reviewOwnerKey(owner), before = state.findingItems[key]?.[itemId];
    if (JSON.stringify(before) === JSON.stringify(findings)) return state;
    return { findingItems: { ...state.findingItems, [key]: { ...state.findingItems[key], [itemId]: structuredClone(findings) } } };
  }),
  open: (target, selectedPath) =>
    set({ target: structuredClone({ ...target, selectedPath }) }),
  close: () => set({ target: null }),
  setCommentDraft: (owner, path, selection, text) => set((state) => {
    const feedback = state.feedback[owner] ?? { drafts: {}, comments: [] };
    return { feedback: { ...state.feedback, [owner]: { ...feedback, drafts: { ...feedback.drafts, [reviewSelectionKey(path, selection)]: text } } } };
  }),
  saveComment: (owner, path, selection) => set((state) => {
    const feedback = state.feedback[owner];
    const id = reviewSelectionKey(path, selection), body = feedback?.drafts[id]?.trim();
    if (!feedback || !body) return state;
    const drafts = { ...feedback.drafts }; delete drafts[id];
    return { feedback: { ...state.feedback, [owner]: { drafts, comments: [...feedback.comments.filter((comment) => comment.id !== id), { id, path, selection: structuredClone(selection), body }] } } };
  }),
  removeComment: (owner, id) => set((state) => {
    const feedback = state.feedback[owner]; if (!feedback) return state;
    return { feedback: { ...state.feedback, [owner]: { ...feedback, comments: feedback.comments.filter((comment) => comment.id !== id) } } };
  }),
  markAddedToDraft: (owner, id) => set((state) => {
    const feedback = state.feedback[owner]; if (!feedback) return state;
    return { feedback: { ...state.feedback, [owner]: { ...feedback, comments: feedback.comments.map((comment) => comment.id === id ? { ...comment, addedToDraft: true } : comment) } } };
  }),
}), { name: "kanban.session.review-comments", version: 1, partialize: (state) => ({ feedback: state.feedback, reviewScopes: state.reviewScopes, findingItems: state.findingItems }) }));
