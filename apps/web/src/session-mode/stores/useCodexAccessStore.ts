import { create } from "zustand";
import {
  threadAccess,
  type CodexAccess,
} from "@session/services/apiAdapt/codex";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import { MutationNotStartedError } from "@session/services/MutationNotStartedError";
import { readWithDeadline } from "@session/services/sessionReadQueue";

type AccessEntry = {
  access?: CodexAccess;
  error?: string;
  unsupported?: boolean;
};
export const useCodexAccessStore = create<{
  entries: Record<string, AccessEntry>;
}>(() => ({ entries: {} }));
// Freshness is metadata, not observable UI state. Identical polls must not rerender chat.
const checked = new Map<string, number>();
const pending = new Map<
  string,
  { promise: Promise<AccessEntry>; controller: AbortController }
>();
let epoch = 0;
function publish(id: string, next: AccessEntry) {
  checked.set(id, Date.now());
  useCodexAccessStore.setState((state) => {
    const entries = { ...state.entries };
    let changed = false;
    for (const [key, time] of checked) {
      if (key !== id && Date.now() - time > 60_000 && !pending.has(key)) {
        checked.delete(key);
        delete entries[key];
        changed = true;
      }
    }
    const old = entries[id];
    if (
      old?.error !== next.error ||
      old?.unsupported !== next.unsupported ||
      old?.access?.state !== next.access?.state ||
      old?.access?.reason !== next.access?.reason ||
      old?.access?.generation !== next.access?.generation ||
      old?.access?.sharedDaemon !== next.access?.sharedDaemon ||
      old?.access?.attached !== next.access?.attached ||
      old?.access?.loaded !== next.access?.loaded ||
      old?.access?.activeTurnId !== next.access?.activeTurnId ||
      !old
    ) {
      entries[id] = next;
      changed = true;
    }
    return changed ? { entries } : state;
  });
  return useCodexAccessStore.getState().entries[id];
}
/** Metadata only: reading this endpoint never resumes or acquires the thread. */
export function refreshCodexAccess(id: string): Promise<AccessEntry> {
  const existing = pending.get(id);
  if (existing) return existing.promise;
  const startedEpoch = epoch;
  const controller = new AbortController();
  const promise = readWithDeadline(
    (signal) => threadAccess(id, false, signal),
    4000,
    controller.signal,
  )
    .then((access) => {
      if (
        !access ||
        ![
          "readonly",
          "owned",
          "external",
          "releasing",
          "acquiring",
          "unknown",
        ].includes(access.state)
      )
        throw new Error("Invalid access response");
      return {
        access: {
          state: access.state,
          reason:
            typeof access.reason === "string"
              ? access.reason.slice(0, 1000)
              : "",
          generation: Number.isSafeInteger(access.generation)
            ? access.generation
            : 0,
          ...(typeof access.sharedDaemon === "boolean"
            ? { sharedDaemon: access.sharedDaemon }
            : {}),
          ...(typeof access.attached === "boolean"
            ? { attached: access.attached }
            : {}),
          ...(typeof access.loaded === "boolean"
            ? { loaded: access.loaded }
            : {}),
          ...(access.activeTurnId === null ||
          (typeof access.activeTurnId === "string" &&
            access.activeTurnId.length > 0 &&
            access.activeTurnId.length <= 512 &&
            !/[\u0000-\u001f\u007f]/u.test(access.activeTurnId))
            ? { activeTurnId: access.activeTurnId }
            : {}),
        },
      } as AccessEntry;
    })
    .catch((error) =>
      error instanceof SessionApiError && error.status === 404
        ? { unsupported: true }
        : { error: "执行占用状态暂时无法确认，请核对后重试" },
    )
    .then((entry) =>
      startedEpoch === epoch
        ? publish(id, entry)
        : { error: "运行服务已变化，请核对后重试" },
    )
    .finally(() => {
      if (pending.get(id)?.controller === controller) pending.delete(id);
    });
  pending.set(id, { promise, controller });
  return promise;
}
export function codexSendBlockReason(entry?: AccessEntry): string | undefined {
  if (entry?.error) return entry.error;
  switch (entry?.access?.state) {
    case "external":
      return "会话被其他客户端占用，未发送，草稿已保留";
    case "releasing":
      return "会话正在释放，未发送，草稿已保留";
    case "acquiring":
      return "正在恢复会话，请稍后发送，草稿已保留";
    case "unknown":
      return "执行占用状态尚未确认，请核对后发送，草稿已保留";
  }
}
export async function assertCodexSendAccess(id: string) {
  const fresh = checked.has(id) && Date.now() - checked.get(id)! < 5000;
  const entry = fresh
    ? useCodexAccessStore.getState().entries[id]
    : await refreshCodexAccess(id);
  const reason = codexSendBlockReason(entry);
  if (reason) throw new MutationNotStartedError(reason);
}
export function resetCodexAccessCache() {
  epoch++;
  for (const { controller } of pending.values()) controller.abort();
  pending.clear();
  checked.clear();
  useCodexAccessStore.setState({ entries: {} });
}
export function startCodexAccessRuntimeSync() {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("session-runtime-restarted", resetCodexAccessCache);
  return () =>
    window.removeEventListener(
      "session-runtime-restarted",
      resetCodexAccessCache,
    );
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    resetCodexAccessCache();
  });
