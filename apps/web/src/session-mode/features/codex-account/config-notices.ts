import { create } from "zustand";
import { z } from "zod";
import type { TextRange } from "@session/bindings/v2";
export interface NativeConfigNotice {
  id: string;
  kind: "configWarning" | "deprecation";
  summary: string;
  details: string | null;
  path?: string;
  range?: TextRange;
}
export const useNativeConfigNoticeStore = create<{
  notices: NativeConfigNotice[];
}>(() => ({ notices: [] }));
const position = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
const schema = z.object({
  summary: z.string(),
  details: z.string().nullable(),
  path: z.string().nullish(),
  range: z.object({ start: position, end: position }).nullish(),
});
/** VSIX Uxe/UBa stores global host notices before thread routing, dedupes
 * equal values and retains the latest 20. These events have no threadId.
 */
export function observeConfigNotice(value: unknown) {
  if (!value || typeof value !== "object") return;
  const payload = value as { method?: string; params?: unknown };
  if (
    payload.method !== "configWarning" &&
    payload.method !== "deprecationNotice"
  )
    return;
  const parsed = schema.safeParse(payload.params);
  if (!parsed.success) return;
  const notice = {
    kind:
      payload.method === "configWarning"
        ? ("configWarning" as const)
        : ("deprecation" as const),
    summary: parsed.data.summary,
    details: parsed.data.details,
    ...(parsed.data.path != null ? { path: parsed.data.path } : {}),
    ...(parsed.data.range != null ? { range: parsed.data.range } : {}),
  };
  const id = JSON.stringify(notice);
  useNativeConfigNoticeStore.setState((state) => ({
    notices: [
      ...state.notices.filter((previous) => previous.id !== id),
      { ...structuredClone(notice), id },
    ].slice(-20),
  }));
}
