import { useEffect } from "react";
import { create } from "zustand";
import type { ComposerContext } from "@agent-orchestrator/shared";
import type { DrawingDocument } from "./drawing";
import {
  contextDraftStorage,
  emptyRecord,
  legacyRecord,
  mergeRecords,
  mergeDrawing,
  readLegacyDrafts,
  revised,
  sameValue,
  type ComposerDraft,
  type ContextRecord,
  type ContextClearIntent,
  applyCapturedClears,
  draftFingerprint,
} from "./draftStorage";
export { CONTEXT_DATABASE } from "./draftStorage";
export type { ComposerDraft } from "./draftStorage";

const EMPTY: ComposerDraft = {
  contexts: [],
  drawings: {},
  expanded: false,
  plain: false,
};
export type ContextDraftStatus = {
  phase: "hydrating" | "saving" | "ready" | "error";
  error: string | null;
};
const HYDRATING: ContextDraftStatus = { phase: "hydrating", error: null };
const records = new Map<string, ContextRecord>(),
  baselines = new Map<string, ContextRecord>();
const unhydratedBases = new Map<string, ContextRecord>();
const versions = new WeakMap<ComposerContext, string>();
const pendingClears = new Map<string, Map<string, ContextClearIntent>>();
const clearKey = (clear: ContextClearIntent) =>
  JSON.stringify([clear.kind, clear.id, clear.revision]);
const dirty = new Set<string>(),
  loads = new Map<string, Promise<void>>(),
  writes = new Map<string, Promise<void>>();
const moving = new Map<string, Promise<void>>(),
  failedMoves = new Map<string, { from: string; to: string }>();
type PendingCommit =
  | {
      kind: "save";
      next: ContextRecord;
      clears?: ContextClearIntent[];
      promise: Promise<Map<string, ContextRecord>>;
    }
  | {
      kind: "move";
      from: string;
      to: string;
      source: ContextRecord;
      target: ContextRecord;
      promise: Promise<Map<string, ContextRecord>>;
    };
const commits = new Map<string, PendingCommit>(),
  restoring = new Map<string, Promise<void>>();
const moveRequests = new Map<
  string,
  { from: string; to: string; promise: Promise<void> }
>();
let disposed = false,
  handedOff = false;
interface GenerationRoute {
  target?: typeof composerDrafts;
  waiting: Array<() => void>;
}
let generationRoute: GenerationRoute | undefined;
export interface ContextDraftHandoff {
  rows: Array<{
    owner: string;
    record: ContextRecord;
    baseline?: ContextRecord;
    unhydrated?: ContextRecord;
    dirty: boolean;
    status?: ContextDraftStatus;
    commit?: PendingCommit;
    clears?: ContextClearIntent[];
  }>;
  moves: Array<{ from: string; to: string }>;
  releaseListener: () => void;
  route?: GenerationRoute;
}
function sourceAfterMove(
  source: ContextRecord,
  local: ContextRecord,
): ContextRecord {
  return {
    ...local,
    contexts: local.contexts.filter(
      (item) =>
        !source.contexts.some(
          (old) =>
            old.value.id === item.value.id && old.revision === item.revision,
        ),
    ),
    drawings: Object.fromEntries(
      Object.entries(local.drawings).filter(
        ([key, item]) => source.drawings[key]?.revision !== item.revision,
      ),
    ),
  };
}
function applyCommitted(
  owner: string,
  commit: PendingCommit,
  saved: Map<string, ContextRecord>,
) {
  if (disposed) return;
  const actual = saved.get(owner)!,
    current = records.get(owner) ?? emptyRecord();
  const before =
    commit.kind === "save"
      ? commit.next
      : owner === commit.from
        ? { ...commit.source, contexts: [], drawings: {} }
        : commit.target;
  const local =
    commit.kind === "move" && owner === commit.from
      ? sourceAfterMove(commit.source, current)
      : current;
  try {
    if (commit.kind === "save")
      for (const clear of commit.clears ?? [])
        pendingClears.get(owner)?.delete(clearKey(clear));
    if (!pendingClears.get(owner)?.size) pendingClears.delete(owner);
    const rebased = applyCapturedClears(mergeRecords(before, local, actual), [
      ...(pendingClears.get(owner)?.values() ?? []),
    ]);
    baselines.set(owner, actual);
    publish(owner, rebased);
    if (!sameValue(rebased, actual)) dirty.add(owner);
    else dirty.delete(owner);
    status(owner, dirty.has(owner) ? "saving" : "ready");
  } catch (error) {
    // The transaction committed. Preserve only this page's later intent, not a
    // fake rollback of the source transfer or an old snapshot to resubmit.
    baselines.set(owner, before);
    publish(owner, local);
    dirty.add(owner);
    fail(owner, error);
    throw error;
  }
}
function project(record: ContextRecord): ComposerDraft {
  for (const item of record.contexts) versions.set(item.value, item.revision);
  return {
    contexts: record.contexts.map((item) => item.value),
    drawings: Object.fromEntries(
      Object.entries(record.drawings).map(([key, item]) => [key, item.value]),
    ),
    expanded: record.expanded,
    plain: record.plain,
  };
}
function initial() {
  try {
    const drafts: Record<string, ComposerDraft> = {};
    for (const [owner, value] of Object.entries(readLegacyDrafts())) {
      const record = legacyRecord(value);
      records.set(owner, record);
      drafts[owner] = project(record);
    }
    return { drafts, error: null as string | null };
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
  status: Record<string, ContextDraftStatus>;
}>(() => ({ ...initial(), status: {} }));
function status(
  owner: string,
  phase: ContextDraftStatus["phase"],
  error: string | null = null,
) {
  if (disposed) return;
  useComposerDraftStore.setState((s) => {
    const states = { ...s.status, [owner]: { phase, error } };
    return {
      status: states,
      error: Object.values(states).find((item) => item.error)?.error ?? null,
    };
  });
}
function publish(owner: string, record: ContextRecord) {
  if (disposed) return;
  records.set(owner, record);
  useComposerDraftStore.setState((s) => ({
    drafts: { ...s.drafts, [owner]: project(record) },
  }));
}
function fail(owner: string, error: unknown) {
  status(
    owner,
    "error",
    "上下文草稿未保存：" +
      (error instanceof Error ? error.message : String(error)) +
      " 请保留页面并重试。",
  );
}
function schedule(owner: string) {
  queueMicrotask(() => {
    if (!disposed && !moving.has(owner)) void flush(owner).catch(() => {});
  });
}
async function ensure(owner: string): Promise<void> {
  const recovery = restoring.get(owner);
  if (recovery) await recovery;
  if (baselines.has(owner)) return;
  const pending = loads.get(owner);
  if (pending) return pending;
  const before =
    unhydratedBases.get(owner) ?? records.get(owner) ?? emptyRecord();
  status(owner, "hydrating");
  const work = contextDraftStorage
    .load(owner)
    .then((saved) => {
      if (disposed) return;
      const local = records.get(owner) ?? before;
      const next = applyCapturedClears(
        local === before ? saved : mergeRecords(before, local, saved),
        [...(pendingClears.get(owner)?.values() ?? [])],
      );
      baselines.set(owner, saved);
      unhydratedBases.delete(owner);
      publish(owner, next);
      if (!sameValue(next, saved)) dirty.add(owner);
      else dirty.delete(owner);
      status(owner, dirty.has(owner) ? "saving" : "ready");
    })
    .catch((error) => {
      fail(owner, error);
      throw error;
    })
    .finally(() => loads.delete(owner));
  loads.set(owner, work);
  return work;
}
async function flush(owner: string): Promise<void> {
  await ensure(owner);
  const move = moving.get(owner);
  if (move) await move;
  let refreshed = false;
  for (;;) {
    const pending = writes.get(owner);
    if (pending) {
      await pending;
      refreshed = true;
      continue;
    }
    if (!dirty.has(owner) && refreshed) return;
    refreshed = true;
    const before = baselines.get(owner)!,
      next = records.get(owner)!;
    dirty.delete(owner);
    status(owner, "saving");
    const clears = [...(pendingClears.get(owner)?.values() ?? [])];
    const commit: PendingCommit = {
      kind: "save",
      next,
      clears,
      promise: contextDraftStorage
        .save(owner, before, next, clears)
        .then((saved) => new Map([[owner, saved]])),
    };
    commits.set(owner, commit);
    const work = commit.promise
      .then((saved) => applyCommitted(owner, commit, saved))
      .catch((error) => {
        if (!disposed) {
          dirty.add(owner);
          fail(owner, error);
        }
        throw error;
      })
      .finally(() => {
        writes.delete(owner);
        if (commits.get(owner) === commit) commits.delete(owner);
      });
    writes.set(owner, work);
    await work;
  }
}
function update(
  owner: string,
  change: (record: ContextRecord) => ContextRecord,
) {
  // Tests and existing callers may explicitly reset the public store. Do not
  // retain an obsolete in-memory owner after such a reset.
  if (!useComposerDraftStore.getState().drafts[owner] && !dirty.has(owner)) {
    records.delete(owner);
    baselines.delete(owner);
  }
  const current = records.get(owner) ?? emptyRecord(),
    next = change(current);
  if (next === current) return;
  if (!baselines.has(owner) && !unhydratedBases.has(owner))
    unhydratedBases.set(owner, current);
  publish(owner, next);
  dirty.add(owner);
  status(owner, baselines.has(owner) ? "saving" : "hydrating");
  schedule(owner);
}
function move(from: string, to: string): Promise<void> {
  if (from === to) return Promise.resolve();
  const key = JSON.stringify([from, to]),
    existing = moveRequests.get(key);
  if (existing) return existing.promise;
  if (
    [...moveRequests.values()].some((item) =>
      [item.from, item.to].some((owner) => owner === from || owner === to),
    )
  )
    return Promise.reject(
      new Error("另一次上下文移动正在进行，请等待完成后重试"),
    );
  let committed = false;
  const promise = (async () => {
    await Promise.all([flush(from), flush(to)]);
    if (disposed) throw new Error("上下文页面已更新，移动草稿已保留待恢复");
    const source = records.get(from)!,
      target = records.get(to)!;
    status(from, "saving");
    status(to, "saving");
    const commit: PendingCommit = {
      kind: "move",
      from,
      to,
      source,
      target,
      promise: contextDraftStorage.move(from, to, source),
    };
    commits.set(from, commit);
    commits.set(to, commit);
    const transfer = commit.promise
      .then((saved) => {
        committed = true;
        if (disposed) return;
        failedMoves.delete(to);
        // Apply both committed owners even if one local rebase needs conflict recovery.
        let failure: unknown;
        for (const owner of [from, to])
          try {
            applyCommitted(owner, commit, saved);
          } catch (error) {
            failure ??= error;
          }
        if (failure) throw failure;
      })
      .finally(() => {
        for (const owner of [from, to]) {
          moving.delete(owner);
          if (commits.get(owner) === commit) commits.delete(owner);
        }
      });
    moving.set(from, transfer);
    moving.set(to, transfer);
    await transfer;
  })()
    .catch((error) => {
      if (!disposed) {
        if (!committed) failedMoves.set(to, { from, to });
        fail(from, error);
        fail(to, error);
      }
      throw error;
    })
    .finally(() => {
      moveRequests.delete(key);
      for (const owner of [from, to])
        if (
          !disposed &&
          dirty.has(owner) &&
          useComposerDraftStore.getState().status[owner]?.phase !== "error"
        )
          schedule(owner);
    });
  moveRequests.set(key, { from, to, promise });
  return promise;
}
const draftApi = {
  read: (owner: string) =>
    useComposerDraftStore.getState().drafts[owner] ?? EMPTY,
  ensure,
  flush,
  move,
  capture: (owner: string) => ({
    contexts: composerDrafts.read(owner).contexts,
    versions: Object.fromEntries(
      (records.get(owner)?.contexts ?? []).map((item) => [
        item.value.id,
        item.revision,
      ]),
    ),
  }),
  matches: (
    owner: string,
    capture: { contexts: ComposerContext[]; versions: Record<string, string> },
  ) => {
    const current = records.get(owner)?.contexts ?? [];
    return (
      current.length === capture.contexts.length &&
      current.every(
        (item, index) =>
          item.revision === capture.versions[item.value.id] &&
          sameValue(item.value, capture.contexts[index]),
      )
    );
  },
  retryStorage: async () => {
    for (const { from, to } of [...failedMoves.values()]) await move(from, to);
    const owners = new Set([
      ...dirty,
      ...Object.entries(useComposerDraftStore.getState().status)
        .filter(([, state]) => state.phase === "error")
        .map(([owner]) => owner),
    ]);
    for (const owner of owners) await flush(owner);
  },
  add: (owner: string, item: ComposerContext) =>
    update(owner, (record) =>
      record.contexts.some((entry) => entry.value.id === item.id)
        ? record
        : { ...record, contexts: [...record.contexts, revised(item)] },
    ),
  replace: (owner: string, id: string, item: ComposerContext) =>
    update(owner, (record) => ({
      ...record,
      contexts: record.contexts.map((entry) =>
        entry.value.id === id ? revised(item) : entry,
      ),
    })),
  remove: (owner: string, id: string) => {
    const record = records.get(owner) ?? emptyRecord(),
      index = record.contexts.findIndex((item) => item.value.id === id),
      captured = record.contexts[index];
    update(owner, (current) => ({
      ...current,
      contexts: current.contexts.filter((item) => item.value.id !== id),
    }));
    let restored = false;
    return async () => {
      if (!captured) return;
      if (restored) return composerDrafts.flush(owner);
      restored = true;
      await composerDrafts.restoreRemoved(owner, captured.value, index);
    };
  },
  restoreRemoved: async (
    owner: string,
    value: ComposerContext,
    index: number,
  ) => {
    update(owner, (current) => {
      if (current.contexts.some((item) => item.value.id === value.id))
        return current;
      const contexts = [...current.contexts];
      contexts.splice(Math.min(index, contexts.length), 0, revised(value));
      return { ...current, contexts };
    });
    await flush(owner);
  },
  clearSubmitted: (
    owner: string,
    items: ComposerContext[],
    capturedVersions?: Record<string, string>,
  ) => {
    const pending =
      pendingClears.get(owner) ?? new Map<string, ContextClearIntent>();
    for (const item of items) {
      const revision = capturedVersions?.[item.id] ?? versions.get(item);
      if (!revision) continue;
      const clear: ContextClearIntent = {
        kind: "context",
        id: item.id,
        revision,
        fingerprint: draftFingerprint(item),
      };
      pending.set(clearKey(clear), clear);
    }
    pendingClears.set(owner, pending);
    update(owner, (record) =>
      applyCapturedClears(record, [...pending.values()]),
    );
  },
  setExpanded: (owner: string, expanded: boolean) =>
    update(owner, (record) => ({ ...record, expanded })),
  setPlain: (owner: string, plain: boolean) =>
    update(owner, (record) => ({ ...record, plain })),
  drawing: (
    owner: string,
    key: string,
    document: DrawingDocument,
    before?: DrawingDocument,
  ) => {
    let value = document;
    update(owner, (record) => {
      if (before && record.drawings[key])
        value = mergeDrawing(before, document, record.drawings[key]?.value);
      return {
        ...record,
        drawings: { ...record.drawings, [key]: revised(value) },
      };
    });
    return value;
  },
  captureDrawing: (owner: string, key: string) =>
    records.get(owner)?.drawings[key],
  restoreSavedDrawing: async (owner: string, key: string) => {
    await ensure(owner);
    const captured = records.get(owner)?.drawings[key]?.revision;
    const active = writes.get(owner);
    if (active) await active.catch(() => {});
    const saved = await contextDraftStorage.load(owner);
    const local = records.get(owner)!;
    if (local.drawings[key]?.revision !== captured)
      throw new Error("绘图在恢复期间已变化，请核对后重试");
    const replace = (record: ContextRecord) => {
      const drawings = { ...record.drawings };
      if (saved.drawings[key]) drawings[key] = saved.drawings[key];
      else delete drawings[key];
      return { ...record, drawings };
    };
    const baseline = replace(baselines.get(owner)!);
    const next = applyCapturedClears(replace(local), [
      ...(pendingClears.get(owner)?.values() ?? []),
    ]);
    baselines.set(owner, baseline);
    publish(owner, next);
    if (!sameValue(next, baseline) || pendingClears.get(owner)?.size)
      dirty.add(owner);
    else dirty.delete(owner);
    status(owner, dirty.has(owner) ? "saving" : "ready");
    if (dirty.has(owner)) schedule(owner);
  },
  clearDrawing: (
    owner: string,
    key: string,
    capture = records.get(owner)?.drawings[key],
  ) => {
    if (!capture) return;
    const clear: ContextClearIntent = {
      kind: "drawing",
      id: key,
      revision: capture.revision,
      fingerprint: draftFingerprint(capture.value),
    };
    const pending =
      pendingClears.get(owner) ?? new Map<string, ContextClearIntent>();
    pending.set(clearKey(clear), clear);
    pendingClears.set(owner, pending);
    update(owner, (record) => applyCapturedClears(record, [clear]));
  },
};
export const composerDrafts: typeof draftApi = new Proxy(draftApi, {
  get(target, key: keyof typeof draftApi) {
    const fn = target[key];
    return (...args: unknown[]) => {
      if (!disposed) return (fn as (...input: unknown[]) => unknown)(...args);
      // Captured old-message ACKs carry their exact versions into the successor.
      // Never resolve their IDs against whatever edit happens to be current now.
      if (key === "clearSubmitted" && args[2] === undefined)
        args[2] = Object.fromEntries(
          (args[1] as ComposerContext[]).flatMap((item) =>
            versions.has(item) ? [[item.id, versions.get(item)!]] : [],
          ),
        );
      if (key === "clearDrawing" && args[2] === undefined) return;
      const call = () =>
        (generationRoute!.target![key] as (...input: unknown[]) => unknown)(
          ...args,
        );
      if (generationRoute?.target) return call();
      if (key === "read") return EMPTY;
      if (key === "capture") return { contexts: [], versions: {} };
      if (key === "matches") return false;
      if (key === "captureDrawing") return undefined;
      const pending = new Promise((resolve, reject) => {
        generationRoute!.waiting.push(() => {
          try {
            resolve(call());
          } catch (error) {
            reject(error);
          }
        });
      });
      // Fire-and-forget callbacks still report errors through the successor store.
      void pending.catch(() => {});
      // Consumers capture the undo function synchronously, including between
      // dispose and successor installation. Queue removal once; retries invoke
      // the same successor undo, whose persistence failure remains retryable.
      if (key === "remove")
        return async () => {
          const undo = (await pending) as () => Promise<void>;
          await undo();
        };
      return key === "drawing" ? args[2] : pending;
    };
  },
});
export function useComposerDraft(owner: string) {
  useEffect(() => {
    void ensure(owner)
      .then(() => (dirty.has(owner) ? flush(owner) : undefined))
      .catch(() => {});
  }, [owner]);
  return useComposerDraftStore((s) => s.drafts[owner] ?? EMPTY);
}
export const useComposerDraftStatus = (owner: string) =>
  useComposerDraftStore((s) => s.status[owner] ?? HYDRATING);
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (
    !handedOff &&
    !dirty.size &&
    !writes.size &&
    !moving.size &&
    !failedMoves.size
  )
    return;
  event.preventDefault();
  event.returnValue = "";
};
let beforeUnloadUsers = 0;
function stopComposerDraftUnloadGuard() {
  if (typeof window === "undefined") return;
  beforeUnloadUsers = 0;
  window.removeEventListener("beforeunload", beforeUnload);
}
export function startComposerDraftUnloadGuard() {
  if (typeof window === "undefined") return () => {};
  if (beforeUnloadUsers++ === 0)
    window.addEventListener("beforeunload", beforeUnload);
  let stopped = false;
  return () => {
    if (stopped || !beforeUnloadUsers) return;
    stopped = true;
    beforeUnloadUsers--;
    if (!beforeUnloadUsers)
      window.removeEventListener("beforeunload", beforeUnload);
  };
}
export function takeContextDraftHandoff(): ContextDraftHandoff {
  const owners = new Set([
    // Transfer the currently loaded clean baselines too. A still-mounted old
    // remove callback needs its observed version and value for conditional
    // deletion/Undo; hydrating a newer row instead could target another edit.
    ...records.keys(),
    ...dirty,
    ...writes.keys(),
    ...commits.keys(),
    ...pendingClears.keys(),
  ]);
  const pendingMoves = [...failedMoves.values()];
  for (const item of moveRequests.values()) {
    owners.add(item.from);
    owners.add(item.to);
    if (commits.get(item.from)?.kind !== "move")
      pendingMoves.push({ from: item.from, to: item.to });
  }
  for (const item of pendingMoves) {
    owners.add(item.from);
    owners.add(item.to);
  }
  const handoff: ContextDraftHandoff = {
    rows: [...owners].map((owner) => ({
      owner,
      record: records.get(owner) ?? emptyRecord(),
      baseline: baselines.get(owner),
      unhydrated: unhydratedBases.get(owner),
      dirty: dirty.has(owner),
      status: useComposerDraftStore.getState().status[owner],
      commit: commits.get(owner),
      clears: [...(pendingClears.get(owner)?.values() ?? [])],
    })),
    moves: pendingMoves,
    releaseListener: stopComposerDraftUnloadGuard,
    route: (generationRoute = { waiting: [] }),
  };
  disposed = true;
  handedOff = true;
  records.clear();
  baselines.clear();
  unhydratedBases.clear();
  dirty.clear();
  loads.clear();
  writes.clear();
  moving.clear();
  failedMoves.clear();
  commits.clear();
  restoring.clear();
  moveRequests.clear();
  pendingClears.clear();
  useComposerDraftStore.setState({ drafts: {}, status: {}, error: null });
  return handoff;
}
export function restoreContextDraftHandoff(handoff: ContextDraftHandoff) {
  handoff.releaseListener();
  for (const row of handoff.rows) {
    publish(row.owner, row.record);
    if (row.baseline) baselines.set(row.owner, row.baseline);
    if (row.unhydrated) unhydratedBases.set(row.owner, row.unhydrated);
    if (row.dirty) dirty.add(row.owner);
    if (row.clears?.length)
      pendingClears.set(
        row.owner,
        new Map(row.clears.map((clear) => [clearKey(clear), clear])),
      );
    status(
      row.owner,
      row.status?.phase ?? "hydrating",
      row.status?.error ?? null,
    );
    if (row.commit) {
      const commit = row.commit;
      commits.set(row.owner, commit);
      const recovery = commit.promise
        .then((saved) => applyCommitted(row.owner, commit, saved))
        .catch((error) => {
          if (!disposed) {
            dirty.add(row.owner);
            fail(row.owner, error);
          }
          throw error;
        })
        .finally(() => {
          restoring.delete(row.owner);
          if (commits.get(row.owner) === commit) commits.delete(row.owner);
        });
      restoring.set(row.owner, recovery);
      void recovery.catch(() => {});
    }
  }
  for (const item of handoff.moves) {
    failedMoves.set(item.to, item);
    fail(item.to, new Error("页面更新前的上下文移动尚未完成，原草稿已保留"));
  }
  for (const row of handoff.rows)
    if (row.dirty || row.commit) schedule(row.owner);
  if (handoff.route) {
    handoff.route.target = composerDrafts;
    for (const run of handoff.route.waiting.splice(0)) run();
  }
}
if (import.meta.hot?.data) {
  const handoff = import.meta.hot.data.contextDraftHandoff as
    | ContextDraftHandoff
    | undefined;
  delete import.meta.hot.data.contextDraftHandoff;
  if (handoff) restoreContextDraftHandoff(handoff);
  import.meta.hot.dispose((data) => {
    data.contextDraftHandoff = takeContextDraftHandoff();
  });
}
