import { v4 as uuid } from "uuid";
import { hash } from "fast-sha256";
import type { ComposerContext } from "@agent-orchestrator/shared";
import type { DrawingDocument } from "./drawing";
import { readWithDeadline } from "@session/services/sessionReadQueue";

export const LEGACY_CONTEXT_KEY = "kanban.session.composer-v2";
export const CONTEXT_DATABASE = "kanban.session.composer-contexts";
export interface ComposerDraft {
  contexts: ComposerContext[];
  drawings: Record<string, DrawingDocument>;
  expanded: boolean;
  plain: boolean;
}
export interface Versioned<T> {
  revision: string;
  value: T;
}
export interface ContextRecord {
  contexts: Versioned<ComposerContext>[];
  drawings: Record<string, Versioned<DrawingDocument>>;
  expanded: boolean;
  plain: boolean;
}
export const emptyRecord = (): ContextRecord => ({
  contexts: [],
  drawings: {},
  expanded: false,
  plain: false,
});
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
export const revised = <T>(value: T): Versioned<T> => ({
  value: structuredClone(value),
  revision: uuid(),
});
const conflict = () =>
  new Error(
    "另一页面已修改这项上下文或绘图，当前修改仍保留；请核对后重新编辑或移除冲突项。",
  );
export function draftFingerprint(value: unknown) {
  return Array.from(
    hash(new TextEncoder().encode(JSON.stringify(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function legacyRevision(value: unknown) {
  return "legacy:" + draftFingerprint(value);
}
export interface ContextClearIntent {
  kind: "context" | "drawing";
  id: string;
  revision: string;
  fingerprint: string;
}
export function applyCapturedClears(
  record: ContextRecord,
  clears: ContextClearIntent[],
): ContextRecord {
  const contexts = record.contexts.filter(
    (item) =>
      !clears.some(
        (clear) =>
          clear.kind === "context" &&
          clear.id === item.value.id &&
          clear.revision === item.revision &&
          clear.fingerprint === draftFingerprint(item.value),
      ),
  );
  const drawings = { ...record.drawings };
  for (const clear of clears)
    if (
      clear.kind === "drawing" &&
      drawings[clear.id]?.revision === clear.revision &&
      draftFingerprint(drawings[clear.id].value) === clear.fingerprint
    )
      delete drawings[clear.id];
  return { ...record, contexts, drawings };
}
export function readLegacyDrafts(): Record<string, ComposerDraft> {
  const value: unknown = JSON.parse(
    localStorage.getItem(LEGACY_CONTEXT_KEY) ?? "{}",
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("上下文草稿格式损坏");
  for (const draft of Object.values(value) as ComposerDraft[]) {
    if (
      !draft ||
      !Array.isArray(draft.contexts) ||
      !draft.drawings ||
      typeof draft.drawings !== "object" ||
      Array.isArray(draft.drawings)
    )
      throw new Error("上下文草稿格式损坏");
    if (
      draft.contexts.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.text !== "string" ||
          typeof item.name !== "string" ||
          typeof item.kind !== "string",
      )
    )
      throw new Error("上下文内容格式损坏");
    for (const document of Object.values(draft.drawings))
      if (
        !document ||
        document.version !== 1 ||
        !Array.isArray(document.marks) ||
        !Number.isFinite(document.width) ||
        !Number.isFinite(document.height)
      )
        throw new Error("绘图草稿格式损坏");
  }
  return value as Record<string, ComposerDraft>;
}
export function legacyRecord(draft?: ComposerDraft): ContextRecord {
  if (!draft) return emptyRecord();
  return {
    contexts: draft.contexts.map((value) => ({
      value,
      revision: legacyRevision(value),
    })),
    drawings: Object.fromEntries(
      Object.entries(draft.drawings).map(([key, value]) => [
        key,
        { value, revision: legacyRevision(value) },
      ]),
    ),
    expanded: !!draft.expanded,
    plain: !!draft.plain,
  };
}

/** Apply only this editor's changed marks; different-page strokes remain present. */
export function mergeDrawing(
  before: DrawingDocument | undefined,
  next: DrawingDocument,
  current: DrawingDocument | undefined,
): DrawingDocument {
  if (!current) {
    if (before) throw conflict();
    return next;
  }
  const previous = new Map(before?.marks.map((mark) => [mark.id, mark]) ?? []);
  const wanted = new Map(next.marks.map((mark) => [mark.id, mark]));
  const marks = new Map(current.marks.map((mark) => [mark.id, mark]));
  for (const [id, old] of previous) {
    const desired = wanted.get(id),
      actual = marks.get(id);
    if (sameValue(old, desired)) continue;
    if (!actual) {
      if (desired) throw conflict();
      continue;
    }
    if (!sameValue(actual, old) && !sameValue(actual, desired))
      throw conflict();
    if (desired) marks.set(id, desired);
    else marks.delete(id);
  }
  for (const [id, mark] of wanted)
    if (!previous.has(id)) {
      if (marks.has(id) && !sameValue(marks.get(id), mark)) throw conflict();
      marks.set(id, mark);
    }
  const result = { ...current, marks: [...marks.values()] };
  for (const field of ["width", "height"] as const) {
    if (before && next[field] === before[field]) continue;
    if (
      before &&
      current[field] !== before[field] &&
      current[field] !== next[field]
    )
      throw conflict();
    if (!before && current[field] !== next[field] && current.marks.length)
      throw conflict();
    result[field] = next[field];
  }
  return result;
}

/** Compare against the captured baseline, never replace another page's whole owner. */
export function mergeRecords(
  before: ContextRecord,
  next: ContextRecord,
  current: ContextRecord,
): ContextRecord {
  const old = new Map(before.contexts.map((item) => [item.value.id, item]));
  const desired = new Map(next.contexts.map((item) => [item.value.id, item]));
  const actual = new Map(current.contexts.map((item) => [item.value.id, item]));
  for (const [id, item] of old)
    if (!desired.has(id) && actual.get(id)?.revision === item.revision)
      actual.delete(id);
  for (const [id, item] of desired) {
    const baseline = old.get(id),
      live = actual.get(id);
    if (baseline?.revision === item.revision) continue;
    if (!baseline) {
      if (
        live &&
        live.revision !== item.revision &&
        !sameValue(live.value, item.value)
      )
        throw conflict();
      if (!live) actual.set(id, item);
    } else {
      if (
        !live ||
        (live.revision !== baseline.revision && live.revision !== item.revision)
      )
        throw conflict();
      actual.set(id, item);
    }
  }
  // Local ordering affects known entries only. Remote additions keep their relative order.
  const contexts = [...actual.values()];
  const knownOrder = next.contexts.map((item) => item.value.id);
  const known = contexts.filter((item) => knownOrder.includes(item.value.id));
  known.sort(
    (a, b) => knownOrder.indexOf(a.value.id) - knownOrder.indexOf(b.value.id),
  );
  let index = 0;
  const ordered = contexts.map((item) =>
    knownOrder.includes(item.value.id) ? known[index++] : item,
  );
  const drawings = { ...current.drawings };
  for (const [key, item] of Object.entries(before.drawings))
    if (!next.drawings[key] && drawings[key]?.revision === item.revision)
      delete drawings[key];
  for (const [key, item] of Object.entries(next.drawings)) {
    if (before.drawings[key]?.revision === item.revision) continue;
    const value = mergeDrawing(
      before.drawings[key]?.value,
      item.value,
      drawings[key]?.value,
    );
    drawings[key] = sameValue(value, item.value) ? item : revised(value);
  }
  return {
    contexts: ordered,
    drawings,
    expanded:
      before.expanded === next.expanded ? current.expanded : next.expanded,
    plain: before.plain === next.plain ? current.plain : next.plain,
  };
}

async function open(signal: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    if (!globalThis.indexedDB)
      return reject(new Error("浏览器不支持上下文草稿存储"));
    const request = indexedDB.open(CONTEXT_DATABASE, 1);
    let settled = false;
    const done = (error?: unknown, db?: IDBDatabase) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(db!);
    };
    const abort = () => done(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    request.onupgradeneeded = () => {
      if (signal.aborted) request.transaction?.abort();
      else request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => done(undefined, request.result);
    request.onerror = () =>
      done(request.error ?? new Error("上下文数据库无法打开"));
    request.onblocked = () => done(new Error("上下文数据库被占用"));
  });
}
async function transaction(
  owners: string[],
  change: (records: Map<string, ContextRecord>) => void,
): Promise<Map<string, ContextRecord>> {
  return readWithDeadline(async (signal) => {
    const db = await open(signal);
    try {
      return await new Promise<Map<string, ContextRecord>>(
        (resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          const tx = db.transaction("drafts", "readwrite"),
            store = tx.objectStore("drafts");
          const records = new Map<string, ContextRecord>();
          let failure: unknown,
            settled = false;
          const done = (error?: unknown) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve(records);
          };
          const abort = () => {
            try {
              tx.abort();
            } catch {}
            done(signal.reason);
          };
          signal.addEventListener("abort", abort, { once: true });
          tx.oncomplete = () => done();
          tx.onabort = () =>
            done(failure ?? tx.error ?? new Error("上下文存储已中断"));
          tx.onerror = () => {
            failure ??= tx.error;
          };
          for (const owner of owners) {
            const request = store.get(owner);
            request.onsuccess = () => {
              try {
                const record =
                  request.result === undefined
                    ? legacyRecord(readLegacyDrafts()[owner])
                    : (request.result as ContextRecord);
                if (
                  !record ||
                  !Array.isArray(record.contexts) ||
                  !record.drawings ||
                  record.contexts.some(
                    (item) => typeof item.revision !== "string" || !item.value,
                  )
                )
                  throw new Error("上下文草稿存储记录损坏");
                records.set(owner, record);
                if (records.size !== owners.length) return;
                change(records);
                // Even an empty row records completed migration. Later old-page
                // localStorage snapshots cannot resurrect previously removed data.
                for (const [key, value] of records) store.put(value, key);
              } catch (error) {
                failure = error;
                try {
                  tx.abort();
                } catch {}
                done(error);
              }
            };
          }
        },
      );
    } finally {
      db.close();
    }
  }, 10_000).catch((error) => {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error("上下文草稿存储超时，请保留页面后重试");
    throw error;
  });
}
export const contextDraftStorage = {
  load: async (owner: string) =>
    (await transaction([owner], () => {})).get(owner)!,
  save: async (
    owner: string,
    before: ContextRecord,
    next: ContextRecord,
    clears: ContextClearIntent[] = [],
  ) =>
    (
      await transaction([owner], (records) =>
        records.set(
          owner,
          applyCapturedClears(
            mergeRecords(before, next, records.get(owner)!),
            clears,
          ),
        ),
      )
    ).get(owner)!,
  move: async (from: string, to: string, captured: ContextRecord) =>
    transaction([from, to], (records) => {
      const source = records.get(from)!,
        target = records.get(to)!;
      const moved = captured.contexts.filter((item) =>
        source.contexts.some(
          (live) =>
            live.value.id === item.value.id && live.revision === item.revision,
        ),
      );
      if (moved.length !== captured.contexts.length) throw conflict();
      const targetIds = new Set(target.contexts.map((item) => item.value.id));
      for (const item of moved)
        if (
          targetIds.has(item.value.id) &&
          !target.contexts.some((old) => old.revision === item.revision)
        )
          throw conflict();
      const drawings = { ...target.drawings },
        remaining = { ...source.drawings };
      for (const [key, item] of Object.entries(captured.drawings)) {
        if (source.drawings[key]?.revision !== item.revision) throw conflict();
        if (!drawings[key]) drawings[key] = item;
        else if (!sameValue(drawings[key].value, item.value)) throw conflict();
        delete remaining[key];
      }
      records.set(from, {
        ...source,
        contexts: source.contexts.filter(
          (item) => !moved.some((value) => value.revision === item.revision),
        ),
        drawings: remaining,
      });
      records.set(to, {
        ...target,
        contexts: [
          ...target.contexts,
          ...moved.filter((item) => !targetIds.has(item.value.id)),
        ],
        drawings,
        expanded: captured.expanded,
        plain: captured.plain,
      });
    }),
};
