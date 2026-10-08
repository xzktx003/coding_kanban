import { create } from "zustand";
import type { ComposerContext } from "@agent-orchestrator/shared";
import type { DrawingDocument } from "./drawing";

interface ComposerDraft {
  contexts: ComposerContext[];
  drawings: Record<string, DrawingDocument>;
  expanded: boolean;
  plain: boolean;
}
const EMPTY: ComposerDraft = {
  contexts: [],
  drawings: {},
  expanded: false,
  plain: false,
};
const KEY = "kanban.session.composer-v2";
function initial(): {
  drafts: Record<string, ComposerDraft>;
  error: string | null;
} {
  try {
    const drafts = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (
      !drafts ||
      typeof drafts !== "object" ||
      Array.isArray(drafts) ||
      Object.values(drafts).some(
        (d: any) => !Array.isArray(d?.contexts) || !d?.drawings,
      )
    )
      throw new Error("草稿格式损坏");
    return { drafts, error: null };
  } catch {
    return {
      drafts: {},
      error: "上下文草稿读取失败，原始数据未覆盖；请备份浏览器数据后恢复",
    };
  }
}
export const useComposerDraftStore = create<{
  drafts: Record<string, ComposerDraft>;
  error: string | null;
}>(() => initial());
let readFailed = !!useComposerDraftStore.getState().error;
function persist() {
  if (readFailed) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(useComposerDraftStore.getState().drafts),
    );
    useComposerDraftStore.setState({ error: null });
  } catch {
    useComposerDraftStore.setState({
      error: "上下文草稿未保存，浏览器存储空间不足；请保留此页面并重试",
    });
  }
}
function update(
  owner: string,
  change: (draft: ComposerDraft) => ComposerDraft,
) {
  useComposerDraftStore.setState((s) => ({
    drafts: { ...s.drafts, [owner]: change(s.drafts[owner] ?? EMPTY) },
  }));
  persist();
}
export const composerDrafts = {
  read: (owner: string) =>
    useComposerDraftStore.getState().drafts[owner] ?? EMPTY,
  retryStorage: () => {
    if (readFailed) {
      const saved = initial();
      if (saved.error) return;
      readFailed = false;
      useComposerDraftStore.setState((s) => {
        const drafts = { ...saved.drafts };
        for (const [owner, memory] of Object.entries(s.drafts)) {
          const stored = saved.drafts[owner] ?? EMPTY,
            ids = new Set(memory.contexts.map((c) => c.id));
          drafts[owner] = {
            ...memory,
            contexts: [
              ...stored.contexts.filter((c) => !ids.has(c.id)),
              ...memory.contexts,
            ],
            drawings: { ...stored.drawings, ...memory.drawings },
          };
        }
        return { drafts, error: null };
      });
    }
    persist();
  },
  add: (owner: string, item: ComposerContext) =>
    update(owner, (d) => ({
      ...d,
      contexts: d.contexts.some((c) => c.id === item.id)
        ? d.contexts
        : [...d.contexts, item],
    })),
  replace: (owner: string, id: string, item: ComposerContext) =>
    update(owner, (d) => ({
      ...d,
      contexts: d.contexts.map((c) => (c.id === id ? item : c)),
    })),
  remove: (owner: string, id: string) => {
    const before = composerDrafts.read(owner),
      index = before.contexts.findIndex((c) => c.id === id),
      item = before.contexts[index];
    update(owner, (d) => ({
      ...d,
      contexts: d.contexts.filter((c) => c.id !== id),
    }));
    let restored = false;
    return () => {
      if (!item || restored) return;
      restored = true;
      update(owner, (d) => {
        const contexts = [...d.contexts];
        if (!contexts.some((c) => c.id === id))
          contexts.splice(Math.min(index, contexts.length), 0, item);
        return { ...d, contexts };
      });
    };
  },
  clearSubmitted: (owner: string, items: ComposerContext[]) =>
    update(owner, (d) => ({
      ...d,
      contexts: d.contexts.filter(
        (c) => !items.some((sent) => sent.id === c.id && sent.text === c.text),
      ),
    })),
  setExpanded: (owner: string, expanded: boolean) =>
    update(owner, (d) => ({ ...d, expanded })),
  setPlain: (owner: string, plain: boolean) =>
    update(owner, (d) => ({ ...d, plain })),
  drawing: (owner: string, key: string, document: DrawingDocument) =>
    update(owner, (d) => ({
      ...d,
      drawings: { ...d.drawings, [key]: document },
    })),
  clearDrawing: (owner: string, key: string) =>
    update(owner, (d) => {
      const drawings = { ...d.drawings };
      delete drawings[key];
      return { ...d, drawings };
    }),
  move: (from: string, to: string) => {
    if (from === to) return;
    useComposerDraftStore.setState((s) => {
      const source = s.drafts[from];
      if (!source) return s;
      const target = s.drafts[to] ?? EMPTY;
      const ids = new Set(target.contexts.map((c) => c.id));
      const drafts = {
        ...s.drafts,
        [to]: {
          ...source,
          contexts: [
            ...target.contexts,
            ...source.contexts.filter((c) => !ids.has(c.id)),
          ],
          drawings: { ...source.drawings, ...target.drawings },
        },
      };
      delete drafts[from];
      return { drafts };
    });
    persist();
  },
};
export const useComposerDraft = (owner: string) =>
  useComposerDraftStore((s) => s.drafts[owner] ?? EMPTY);
