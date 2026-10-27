import { create } from "zustand";
import { toast } from "sonner";

export interface ConversationFormDraft {
  fields: Record<string, string>;
  revision: number;
  dirty: boolean;
  pending: string | null;
  error: string | null;
  receipt: string | null;
}
const empty = (): ConversationFormDraft => ({
  fields: {},
  revision: 0,
  dirty: false,
  pending: null,
  error: null,
  receipt: null,
});
/** Small, page-local form fields only. No transcript, account object or operation scope is retained. */
const createDraftStore = () =>
  create<{ drafts: Record<string, ConversationFormDraft> }>(() => ({
    drafts: {},
  }));
export const useConversationFormDrafts: ReturnType<typeof createDraftStore> =
  import.meta.hot?.data?.conversationFormDrafts ?? createDraftStore();
const references: Map<string, number> =
  import.meta.hot?.data?.conversationFormReferences ?? new Map();
const MAX_DRAFTS = 64,
  MAX_BYTES = 2 * 1024 * 1024;
function bytes(drafts: Record<string, ConversationFormDraft>) {
  return Object.values(drafts).reduce(
    (n, d) => n + Object.values(d.fields).reduce((s, v) => s + v.length * 2, 0),
    0,
  );
}
export function reserveConversationForm(key: string) {
  const all = useConversationFormDrafts.getState().drafts;
  if (all[key]) return;
  if (Object.keys(all).length >= MAX_DRAFTS)
    throw new Error(
      "本页表单草稿已满，请先完成或清空已有表单；未保存内容已保留。",
    );
  useConversationFormDrafts.setState({ drafts: { ...all, [key]: empty() } });
}
export function changeConversationForm(
  key: string,
  field: string,
  value: string,
  initialize = false,
) {
  reserveConversationForm(key);
  const all = useConversationFormDrafts.getState().drafts,
    draft = all[key];
  if (
    (initialize && draft.fields[field] !== undefined) ||
    draft.fields[field] === value
  )
    return;
  const next = {
    ...draft,
    fields: { ...draft.fields, [field]: value },
    revision: draft.revision + 1,
    dirty: initialize
      ? draft.dirty
      : Object.values({ ...draft.fields, [field]: value }).some(Boolean),
    error: null,
  };
  const drafts = { ...all, [key]: next };
  if (bytes(drafts) > MAX_BYTES) {
    toast.error("表单内容超过本页草稿容量，请缩短后重试；已有内容已保留。");
    return;
  }
  useConversationFormDrafts.setState({ drafts });
}
export function updateConversationForm(
  key: string,
  change: (draft: ConversationFormDraft) => ConversationFormDraft,
) {
  const all = useConversationFormDrafts.getState().drafts;
  if (!all[key]) return;
  const next = change(all[key]);
  if (next === all[key]) return;
  useConversationFormDrafts.setState({ drafts: { ...all, [key]: next } });
}
export function releaseEmptyConversationForm(key: string) {
  const all = useConversationFormDrafts.getState().drafts,
    d = all[key];
  if (!d || d.dirty || d.pending || (references.get(key) ?? 0) > 0) return;
  const drafts = { ...all };
  delete drafts[key];
  useConversationFormDrafts.setState({ drafts });
}
export function retainConversationForm(key: string) {
  reserveConversationForm(key);
  references.set(key, (references.get(key) ?? 0) + 1);
  return () => {
    const remaining = (references.get(key) ?? 1) - 1;
    if (remaining > 0) references.set(key, remaining);
    else references.delete(key);
    releaseEmptyConversationForm(key);
  };
}
export function resetConversationFormDraftsForTests() {
  useConversationFormDrafts.setState({ drafts: {} });
}
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (
    Object.values(useConversationFormDrafts.getState().drafts).some(
      (d: any) => d.dirty || d.pending,
    )
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
};
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", beforeUnload);
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.conversationFormDrafts = useConversationFormDrafts;
    data.conversationFormReferences = references;
    if (typeof window !== "undefined")
      window.removeEventListener("beforeunload", beforeUnload);
  });
