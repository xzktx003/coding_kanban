import { create } from "zustand";
import type {
  ManagedSessionKind,
  SessionManagementAction,
  SessionManagementEntry,
  SharedSessionManagement,
} from "@agent-orchestrator/shared";
import { usePinStore, type PinnedItem } from "../stores/usePinStore";
import {
  useSessionAttentionStore,
  type ReplyReceipt,
} from "../stores/useSessionAttentionStore";
import {
  SessionManagementSync,
  MANAGEMENT_OPERATION_PREFIX,
} from "./sessionManagementSync";

export const useSessionManagementSyncStatus = create<{
  pending: number;
  blocked: number;
  error?: string;
}>(() => ({ pending: 0, blocked: 0 }));
let active: SessionManagementSync | undefined;
let publishing = false;
let wake: (() => void) | undefined;
let stopActive: (() => void) | undefined;
let activeFetch: typeof fetch | undefined;
export interface SessionReadProof {
  namespace: string;
  threadId: string;
  replyId: string;
  revision: string;
  scope: string;
}
const readProofs = new Map<string, SessionReadProof>();
const key = (kind: string, id: string) => `${kind}:${id}`;
export interface SharedPinProof {
  namespace: string;
  kind: PinnedItem["kind"];
  id: string;
  revision: number;
  value: boolean;
}

/** Async menu transactions wait for the exact server receipt. Undo/redo carries
 * the previous receipt revision, so it cannot overwrite a newer device action.
 */
export async function setSharedSessionPin(
  item: PinnedItem,
  value: boolean,
  expected?: SharedPinProof,
): Promise<SharedPinProof> {
  const sync = active;
  const snapshot = sync?.projection();
  const namespace = snapshot?.namespaces[item.kind];
  if (!sync || !namespace)
    throw new Error("尚未确认共享管理状态，请连接后重试");
  const operationId = sync.record(item.kind, item.id, (entry) => {
    const revision = entry?.pinRevision ?? 0;
    if (
      expected &&
      (expected.namespace !== namespace ||
        expected.kind !== item.kind ||
        expected.id !== item.id ||
        expected.revision !== revision ||
        expected.value !== (entry?.pinned ?? false))
    )
      throw new Error("置顶状态已被其他操作更新，请查看最新状态后重试");
    return {
      type: "pin",
      value,
      expectedRevision: revision,
      title: item.title,
      ...(item.cwd ? { cwd: item.cwd } : {}),
    };
  });
  wake?.();
  const ack = await sync.confirmation(operationId);
  const entry = ack.entry;
  if (!entry || entry.pinned !== value) throw new Error("置顶操作结果待核对");
  return {
    namespace,
    kind: item.kind,
    id: item.id,
    revision: entry.pinRevision,
    value,
  };
}

/** Proofs are observation-scoped metadata, never restored as permission. */
export async function prepareVisibleSessionRead(
  threadId: string,
  replyId: string,
  signal: AbortSignal,
) {
  const sync = active;
  if (!sync) return undefined; // Isolated/older local-only workbenches retain local receipts.
  const namespace = sync.projection()?.namespaces.codex;
  if (!namespace) throw new Error("尚未确认当前 Codex 账号范围，请连接后重试");
  const query = new URLSearchParams({ threadId, replyId, namespace });
  const response = await (activeFetch ?? fetch)(
    `/api/session/management/read-context?${query}`,
    { signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error("尚未确认对应回复的已读状态，请重新进入会话后核对");
  const value = await response.json();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (active !== sync || sync.projection()?.namespaces.codex !== namespace)
    throw new Error("账号范围已变化，请重新查看对应回复");
  if (
    value.replyId !== replyId ||
    typeof value.revision !== "string" ||
    !value.revision ||
    typeof value.scope !== "string" ||
    !value.scope
  )
    throw new Error("会话已读状态不完整");
  return {
    namespace,
    threadId,
    replyId,
    revision: value.revision as string,
    scope: value.scope as string,
  };
}
export function withVisibleSessionReadProof<T>(
  kind: ManagedSessionKind,
  id: string,
  proof: SessionReadProof | undefined,
  work: () => T,
): T | undefined {
  if (
    kind === "codex" &&
    active &&
    (!proof ||
      proof.threadId !== id ||
      proof.namespace !== active.projection()?.namespaces.codex)
  )
    return;
  const target = key(kind, id);
  if (proof) readProofs.set(target, proof);
  try {
    return work();
  } finally {
    readProofs.delete(target);
  }
}

function readIntent(kind: ManagedSessionKind, id: string) {
  const sync = active,
    snapshot = sync?.projection(),
    namespace = snapshot?.namespaces[kind];
  if (!sync || !namespace)
    throw new Error("尚未确认共享管理范围，请连接后重试");
  const entry = snapshot!.entries.find(
    (item) =>
      item.kind === kind && item.id === id && item.namespace === namespace,
  );
  return { sync, namespace, entry };
}
async function prepareReadIntent(
  kind: ManagedSessionKind,
  id: string,
  replyId: string,
) {
  if (kind !== "codex") return undefined;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await prepareVisibleSessionRead(id, replyId, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
const nativeReadFields = (proof: SessionReadProof | undefined) =>
  proof ? { nativeReadRevision: proof.revision, nativeScope: proof.scope } : {};

/** Explicit management intent. A fresh bounded proof is captured once; errors never rebase or resend it. */
export async function setSharedSessionUnread(
  kind: ManagedSessionKind,
  id: string,
): Promise<boolean> {
  if (!active) return useSessionAttentionStore.getState().markUnread(kind, id);
  const { sync, namespace, entry } = readIntent(kind, id),
    replyId = entry?.completed.at(-1)?.id;
  if (!replyId) return false;
  const manualRevision = entry!.manualUnreadRevision;
  const proof = await prepareReadIntent(kind, id, replyId);
  const current = readIntent(kind, id);
  if (
    current.sync !== sync ||
    current.namespace !== namespace ||
    current.entry?.completed.at(-1)?.id !== replyId ||
    current.entry.manualUnreadRevision !== manualRevision
  )
    throw new Error("会话或未读意图已变化，请重新核对后标记");
  const operationId = sync.record(kind, id, () => ({
    type: "unread",
    ...nativeReadFields(proof),
  }));
  wake?.();
  const ack = await sync.confirmation(operationId);
  if (
    !ack.entry ||
    ack.entry.manualUnreadRevision !== manualRevision + 1 ||
    ack.entry.read.includes(replyId)
  )
    throw new Error("标记未读的结果待核对");
  return true;
}

/** Explicit "mark all read" is separate from the visibility dwell used for automatic reading. */
export async function markSharedSessionsRead(ids: string[]): Promise<number> {
  if (!active) return useSessionAttentionStore.getState().markFollowedRead(ids);
  const sync = active,
    namespace = sync.projection()?.namespaces.codex;
  if (!namespace) throw new Error("尚未确认共享管理范围，请连接后重试");
  const targets = [...new Set(ids)]
    .map((id) => readIntent("codex", id))
    .filter((target) =>
      target.entry?.completed.some(
        (reply) => !target.entry!.read.includes(reply.id),
      ),
    );
  let count = 0;
  for (const target of targets) {
    const entry = target.entry!,
      id = entry.id,
      replyId = entry.completed.at(-1)!.id;
    const proof = await prepareReadIntent("codex", id, replyId);
    const current = readIntent("codex", id);
    if (
      current.sync !== sync ||
      current.namespace !== namespace ||
      current.entry?.completed.at(-1)?.id !== replyId ||
      current.entry.manualUnreadRevision !== entry.manualUnreadRevision
    )
      throw new Error("会话或未读意图已变化，已完成的标记保留，其余请重新核对");
    const operationId = sync.record("codex", id, () => ({
      type: "read",
      replyId,
      manualUnreadRevision: entry.manualUnreadRevision,
      ...nativeReadFields(proof),
    }));
    wake?.();
    const ack = await sync.confirmation(operationId);
    if (!ack.entry?.read.includes(replyId))
      throw new Error("部分会话的已读结果待核对");
    count++;
  }
  return count;
}

const samePins = (a: PinnedItem[], b: PinnedItem[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.id === b[i].id &&
      p.kind === b[i].kind &&
      p.title === b[i].title &&
      p.cwd === b[i].cwd &&
      p.namespace === b[i].namespace,
  );
const sameReceipt = (a: ReplyReceipt | undefined, b: ReplyReceipt) =>
  a &&
  (a.manualUnreadRevision ?? 0) === (b.manualUnreadRevision ?? 0) &&
  a.completed.length === b.completed.length &&
  a.completed.every(
    (r, i) => r.id === b.completed[i].id && r.at === b.completed[i].at,
  ) &&
  a.read.length === b.read.length &&
  a.read.every((id, i) => id === b.read[i]);

/** One lifecycle per workbench. Imports have no global subscriptions or API effects. */
export function startSessionManagementSync(
  fetcher: typeof fetch = fetch,
  pollMs = 3000,
) {
  if (active) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastNamespaces: SharedSessionManagement["namespaces"] | undefined;
  try {
    const stored = JSON.parse(
      localStorage.getItem("kanban.session.management.namespaces") ?? "null",
    );
    if (
      stored &&
      ["codex", "cc", "acp"].every(
        (k) => stored[k] === null || typeof stored[k] === "string",
      )
    )
      lastNamespaces = stored;
  } catch {
    /* Legacy local receipts remain local until scope is confirmed. */
  }
  const status = (error?: string) => {
    let pending = 0,
      blocked = 0;
    try {
      const operations = sync.pending();
      pending = operations.length;
      blocked = operations.filter((op) => op.state !== "pending").length;
      error ??= operations.find((op) => op.state !== "pending")?.error;
    } catch (e) {
      error = e instanceof Error ? e.message : "管理操作记录无法读取";
    }
    const previous = useSessionManagementSyncStatus.getState();
    if (
      previous.pending !== pending ||
      previous.blocked !== blocked ||
      previous.error !== error
    )
      useSessionManagementSyncStatus.setState({ pending, blocked, error });
  };
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: fetcher,
    error: (message) => status(message),
    success: () => status(),
    apply(snapshot) {
      publishing = true;
      try {
        const localPins = usePinStore.getState().pinned;
        // Legacy unscoped pins remain local; a remote snapshot never publishes
        // or silently deletes them. A new explicit pin action uses current scope.
        const legacy = localPins.filter(
          (p) =>
            !p.namespace &&
            !snapshot.entries.some((e) => e.kind === p.kind && e.id === p.id),
        );
        const shared = snapshot.entries
          .filter((e) => e.pinned && e.kind !== "acp")
          .map((e) => ({
            kind: e.kind as PinnedItem["kind"],
            id: e.id,
            title: e.title ?? e.id,
            cwd: e.cwd ?? "",
            namespace: e.namespace,
          }));
        const nextPins = [...shared, ...legacy];
        if (!samePins(localPins, nextPins))
          usePinStore.setState({ pinned: nextPins });
        const old = useSessionAttentionStore.getState().receipts;
        const next = { ...old };
        let changed = false;
        for (const kind of ["codex", "cc", "acp"] as const) {
          if (
            lastNamespaces &&
            lastNamespaces[kind] === snapshot.namespaces[kind]
          )
            continue;
          const previous = Object.fromEntries(
            Object.entries(old).filter(([id]) => id.startsWith(kind + ":")),
          );
          // Keep an isolated local recovery copy, never upload it into a new account.
          if (Object.keys(previous).length)
            localStorage.setItem(
              `kanban.session.management.legacy.${kind}`,
              JSON.stringify(previous),
            );
          for (const id of Object.keys(next))
            if (id.startsWith(kind + ":")) {
              delete next[id];
              changed = true;
            }
        }
        for (const entry of snapshot.entries) {
          const target = key(entry.kind, entry.id);
          const receipt = {
            completed: entry.completed,
            read: entry.read,
            manualUnreadRevision: entry.manualUnreadRevision,
          };
          if (!sameReceipt(next[target], receipt)) {
            next[target] = receipt;
            changed = true;
          }
        }
        if (changed) useSessionAttentionStore.setState({ receipts: next });
        lastNamespaces = { ...snapshot.namespaces };
        localStorage.setItem(
          "kanban.session.management.namespaces",
          JSON.stringify(lastNamespaces),
        );
      } finally {
        publishing = false;
      }
      status();
    },
  });
  active = sync;
  activeFetch = fetcher;
  const record = (
    kind: ManagedSessionKind,
    id: string,
    action: (entry?: SessionManagementEntry) => SessionManagementAction,
  ) => {
    if (publishing || stopped) return;
    try {
      sync.record(kind, id, action);
      status();
      schedule(0);
    } catch (error) {
      status(error instanceof Error ? error.message : "会话管理更改等待同步");
    }
  };
  const unpin = usePinStore.subscribe((state, before) => {
    if (publishing || state.pinned === before.pinned) return;
    const previous = new Map(before.pinned.map((p) => [key(p.kind, p.id), p]));
    const current = new Map(state.pinned.map((p) => [key(p.kind, p.id), p]));
    for (const [id, item] of current)
      if (!previous.has(id))
        record(item.kind, item.id, (e) => ({
          type: "pin",
          value: true,
          expectedRevision: e?.pinRevision ?? 0,
          title: item.title,
          ...(item.cwd ? { cwd: item.cwd } : {}),
        }));
    for (const [id, item] of previous)
      if (!current.has(id))
        record(item.kind, item.id, (e) => ({
          type: "pin",
          value: false,
          expectedRevision: e?.pinRevision ?? 0,
        }));
  });
  const unattention = useSessionAttentionStore.subscribe((state, before) => {
    if (publishing || state.receipts === before.receipts) return;
    for (const [target, receipt] of Object.entries(state.receipts)) {
      if (receipt === before.receipts[target]) continue;
      const divider = target.indexOf(":"),
        kind = target.slice(0, divider) as ManagedSessionKind,
        id = target.slice(divider + 1);
      if (!["codex", "cc", "acp"].includes(kind) || !id) continue;
      const previous = before.receipts[target];
      for (const reply of receipt.completed)
        if (!previous?.completed.some((r) => r.id === reply.id))
          record(kind, id, () => ({ type: "complete", replyId: reply.id }));
      if (
        (receipt.manualUnreadRevision ?? 0) >
        (previous?.manualUnreadRevision ?? 0)
      )
        record(kind, id, () => ({ type: "unread" }));
      const added = receipt.completed
        .filter(
          (r) => receipt.read.includes(r.id) && !previous?.read.includes(r.id),
        )
        .at(-1);
      if (added) {
        const proof = readProofs.get(target);
        if (proof && proof.replyId !== added.id) continue;
        record(kind, id, () => ({
          type: "read",
          replyId: added.id,
          manualUnreadRevision: receipt.manualUnreadRevision ?? 0,
          ...(proof
            ? { nativeReadRevision: proof.revision, nativeScope: proof.scope }
            : {}),
        }));
      }
    }
  });
  function schedule(delay = pollMs) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void tick(), delay);
  }
  async function tick() {
    await sync.syncOnce();
    if (!stopped) {
      status(useSessionManagementSyncStatus.getState().error);
      schedule();
    }
  }
  const wakeOnStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(MANAGEMENT_OPERATION_PREFIX)) schedule(0);
  };
  const onFocus = () => schedule(0);
  wake = onFocus;
  window.addEventListener("storage", wakeOnStorage);
  window.addEventListener("focus", onFocus);
  schedule(0);
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    sync.close();
    unpin();
    unattention();
    active = undefined;
    activeFetch = undefined;
    wake = undefined;
    readProofs.clear();
    window.removeEventListener("storage", wakeOnStorage);
    window.removeEventListener("focus", onFocus);
  };
  stopActive = stop;
  return stop;
}
export const retrySessionManagementSync = () => wake?.();
export const isSharedSessionManagementActive = () => active !== undefined;
export const pendingSessionManagementOperations = () => active?.pending() ?? [];
export const dismissSessionManagementOperation = (operationId: string) => {
  active?.dismiss(operationId);
  wake?.();
};
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopActive?.();
    stopActive = undefined;
  });
