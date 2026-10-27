import { v4 as uuid } from "uuid";
/** Per-thread IndexedDB intent log. Rows contain bounded settings metadata only. */
export const THREAD_MODEL_DATABASE = "kanban.session.thread-models.v1";
export const THREAD_MODEL_LEGACY_KEY = "kanban.session.codex-thread-models";
export type ThreadModelStorageStatus = {
  status: "loading" | "saving" | "ready" | "error" | "conflict";
  error?: string;
};
export type ThreadModelReadToken = {
  version: 1;
  scope: string | null;
  epoch: number;
  stamps: Record<string, string>;
};
export type SettingsIntent<P = unknown> = {
  id: string;
  kind: "edit" | "observe" | "ack" | "dismiss";
  groups: string[];
  payload: P;
  readToken: ThreadModelReadToken;
  noticeIdentity?: string;
};
export type SettingsRow<E> = {
  id: string;
  version: 1;
  serial: number;
  entry?: E;
  stamps: Record<string, string>;
  receipts: string[];
};
export class ThreadModelPersistenceError extends Error {
  constructor(
    message: string,
    readonly kind: "error" | "conflict" | "changed" = "error",
  ) {
    super(message);
    this.name = "ThreadModelPersistenceError";
  }
}
interface Options<E, P> {
  databaseName?: string;
  indexedDB?: IDBFactory;
  legacy?: () => Record<string, E>;
  clean: (entry: E) => E;
  reduce: (entry: E | undefined, intent: SettingsIntent<P>) => E | undefined;
  get: (id: string) => E | undefined;
  apply: (id: string, entry: E | undefined) => void;
  status: (id: string, status: ThreadModelStorageStatus) => void;
  connectEvents?: boolean;
  timeoutMs?: number;
}
export function sameThreadModelValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameThreadModelValue(left[key], right[key]),
    )
  );
}
const equivalent = sameThreadModelValue;
function validRow<E>(raw: unknown, id: string): SettingsRow<E> {
  if (raw == null)
    return { id, version: 1, serial: 0, stamps: {}, receipts: [] };
  const r = raw as SettingsRow<E>;
  if (
    r.id !== id ||
    r.version !== 1 ||
    !Number.isSafeInteger(r.serial) ||
    r.serial < 0 ||
    !r.stamps ||
    typeof r.stamps !== "object" ||
    Array.isArray(r.stamps) ||
    Object.values(r.stamps).some((v) => typeof v !== "string") ||
    !Array.isArray(r.receipts) ||
    r.receipts.length > 64 ||
    r.receipts.some((v) => typeof v !== "string")
  )
    throw new ThreadModelPersistenceError(
      "会话设置缓存损坏，已保留本机选择；请重试。",
    );
  return r;
}
type Completion<E> = {
  promise: Promise<SettingsRow<E>>;
  resolve: (row: SettingsRow<E>) => void;
  reject: (error: unknown) => void;
};
interface PersistenceState<E, P> {
  options: Options<E, P>;
  connection?: Promise<IDBDatabase>;
  scope: string | null;
  epoch: number;
  rows: Map<string, SettingsRow<E>>;
  queues: Map<string, SettingsIntent<P>[]>;
  running: Map<string, Promise<void>>;
  loading: Map<string, Promise<void>>;
  failures: Map<string, ThreadModelPersistenceError>;
  nativeTransactions: Set<IDBTransaction>;
  publish?: (id: string) => void;
  controller?: unknown;
  completions: WeakMap<object, Completion<E>>;
  captures: WeakMap<
    object,
    { promise: Promise<void>; saved: boolean; error?: unknown }
  >;
}
export function createThreadModelPersistence<E, P>(
  options: Options<E, P>,
  adopted?: PersistenceState<E, P>,
) {
  const name = options.databaseName ?? THREAD_MODEL_DATABASE;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const shared: PersistenceState<E, P> = adopted ?? {
    options,
    scope: "0",
    epoch: 0,
    rows: new Map(),
    queues: new Map(),
    running: new Map(),
    loading: new Map(),
    failures: new Map(),
    nativeTransactions: new Set(),
    completions: new WeakMap(),
    captures: new WeakMap(),
  };
  // Hot replacement adopts the actual pending intent queue/transactions. Both
  // old in-flight continuations and new calls use the new pure reducer/callbacks.
  shared.options = options;
  shared.completions ??= new WeakMap();
  shared.captures ??= new WeakMap();
  let disposed = false;
  let channel: BroadcastChannel | undefined;
  const { rows, queues, running, loading, failures, nativeTransactions } =
    shared;
  const status = (id: string, next: ThreadModelStorageStatus) =>
    shared.options.status(id, next);
  const token = (id: string): ThreadModelReadToken => {
    const stamps = { ...rows.get(id)?.stamps };
    for (const op of queues.get(id) ?? []) {
      if (
        (op.kind === "observe" || op.kind === "ack") &&
        (op.readToken.scope !== shared.scope ||
          op.readToken.epoch !== shared.epoch ||
          !equivalent(op.readToken.stamps, stamps))
      )
        continue;
      if (op.kind !== "dismiss")
        for (const group of op.groups) stamps[group] = op.id;
    }
    return { version: 1, scope: shared.scope, epoch: shared.epoch, stamps };
  };
  const live = (read: ThreadModelReadToken) =>
    read.scope === shared.scope && read.epoch === shared.epoch;
  function db(): Promise<IDBDatabase> {
    if (!factory)
      return Promise.reject(
        new ThreadModelPersistenceError(
          "浏览器无法保存会话设置，请启用 IndexedDB 后重试。",
        ),
      );
    if (shared.connection) return shared.connection;
    shared.connection = new Promise<IDBDatabase>((resolve, reject) => {
      let abandoned = false;
      const timer = setTimeout(() => {
        abandoned = true;
        reject(new Error("打开会话设置存储超时，请重试。"));
      }, timeoutMs);
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("threads", { keyPath: "id" });
        request.result.createObjectStore("migration");
      };
      request.onerror = () => {
        clearTimeout(timer);
        abandoned = true;
        reject(request.error ?? new Error("IndexedDB open failed"));
      };
      request.onblocked = () => {
        clearTimeout(timer);
        abandoned = true;
        reject(new Error("会话设置数据库正在升级，请关闭旧页后重试。"));
      };
      request.onsuccess = () => {
        const result = request.result;
        clearTimeout(timer);
        if (abandoned) {
          result.close();
          return;
        }
        result.onversionchange = () => {
          result.close();
          shared.connection = undefined;
        };
        resolve(result);
      };
    }).catch((error) => {
      shared.connection = undefined;
      throw error;
    });
    return shared.connection;
  }
  function failure(id: string, error: unknown) {
    const normalized =
      error instanceof ThreadModelPersistenceError
        ? error
        : new ThreadModelPersistenceError(
            `会话设置未保存：${error instanceof Error ? error.message : String(error)}`,
          );
    failures.set(id, normalized);
    status(id, {
      status: normalized.kind === "conflict" ? "conflict" : "error",
      error: normalized.message,
    });
    return normalized;
  }
  async function read(id: string): Promise<SettingsRow<E>> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(["threads", "migration"], "readwrite");
      const store = tx.objectStore("threads"),
        migration = tx.objectStore("migration");
      let answer: SettingsRow<E>, error: unknown;
      const timer = setTimeout(() => {
        error = new Error("读取会话设置超时，请重试。");
        try {
          tx.abort();
        } catch {
          reject(error);
        }
      }, timeoutMs);
      tx.addEventListener("abort", () => clearTimeout(timer));
      tx.addEventListener("complete", () => clearTimeout(timer));
      tx.onabort = () =>
        reject(error ?? tx.error ?? new Error("Settings read aborted"));
      tx.onerror = () => {
        /* onabort owns settlement */
      };
      tx.oncomplete = () => resolve(answer);
      const marker = migration.get("legacy-v2-imported");
      marker.onsuccess = () => {
        try {
          if (!marker.result) {
            // One transaction imports once; the original localStorage remains a
            // read-only backup. Later old-page rewrites cannot resurrect it.
            for (const [key, entry] of Object.entries(
              shared.options.legacy?.() ?? {},
            )) {
              if (!key || key.length > 4096)
                throw new Error("Invalid legacy thread ID");
              const clean = shared.options.clean(entry);
              store.put({
                id: key,
                version: 1,
                serial: 0,
                entry: clean,
                stamps: {},
                receipts: [],
              });
            }
            migration.put({ version: 2, imported: true }, "legacy-v2-imported");
          }
          const request = store.get(id);
          request.onsuccess = () => {
            try {
              answer = validRow<E>(request.result, id);
              if (answer.entry !== undefined)
                answer = {
                  ...answer,
                  entry: shared.options.clean(answer.entry),
                };
              // An explicit empty row is also a migration tombstone.
              if (!request.result) store.put(answer);
            } catch (e) {
              error = e;
              tx.abort();
            }
          };
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
    });
  }
  function project(id: string) {
    let entry = rows.get(id)?.entry;
    const stamps = { ...rows.get(id)?.stamps };
    for (const op of queues.get(id) ?? []) {
      if (
        (op.kind === "observe" || op.kind === "ack") &&
        (!live(op.readToken) || !equivalent(stamps, op.readToken.stamps))
      )
        continue;
      const next = shared.options.reduce(entry, op);
      if (!equivalent(entry, next) && op.kind !== "dismiss")
        for (const group of op.groups) stamps[group] = op.id;
      entry = next;
    }
    shared.options.apply(id, entry);
  }
  async function ensure(id: string, refresh = false): Promise<void> {
    if (!id || id.length > 4096)
      throw new ThreadModelPersistenceError("无效会话标识");
    if (!refresh && rows.has(id)) return;
    const existing = loading.get(id);
    if (existing) return existing;
    if (!queues.get(id)?.length) status(id, { status: "loading" });
    const work = read(id)
      .then((row) => {
        rows.set(id, row);
        project(id);
        if (!queues.get(id)?.length && !failures.has(id))
          status(id, { status: "ready" });
      })
      .catch((error) => {
        throw failure(id, error);
      })
      .finally(() => loading.delete(id));
    loading.set(id, work);
    return work;
  }
  async function commit(
    id: string,
    op: SettingsIntent<P>,
  ): Promise<SettingsRow<E>> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("threads", "readwrite");
      const store = tx.objectStore("threads");
      if (op.kind === "observe" || op.kind === "ack")
        nativeTransactions.add(tx);
      let answer: SettingsRow<E>, error: unknown;
      const timer = setTimeout(() => {
        error = new Error("保存会话设置超时，请重试。");
        try {
          tx.abort();
        } catch {
          reject(error);
        }
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        nativeTransactions.delete(tx);
      };
      tx.onabort = () => {
        finish();
        reject(error ?? tx.error ?? new Error("Settings transaction aborted"));
      };
      tx.onerror = () => {};
      tx.oncomplete = () => {
        finish();
        resolve(answer);
      };
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const current = validRow<E>(request.result, id);
          if (current.receipts.includes(op.id)) {
            answer = current;
            return;
          }
          if (op.kind === "observe" || op.kind === "ack") {
            // These are read/receipt barriers, not wall-clock freshness guesses.
            if (
              !live(op.readToken) ||
              !equivalent(current.stamps, op.readToken.stamps)
            ) {
              answer = current;
              return;
            }
          }
          if (
            op.kind === "edit" &&
            op.groups.some(
              (group) => current.stamps[group] !== op.readToken.stamps[group],
            )
          )
            throw new ThreadModelPersistenceError(
              "另一页面修改了同一组会话设置。本机选择尚未保存；核对后可重试。",
              "conflict",
            );
          const next = shared.options.reduce(current.entry, op);
          if (equivalent(next, current.entry)) {
            answer = current;
            return;
          }
          const stamps = { ...current.stamps };
          if (op.kind !== "dismiss")
            for (const group of op.groups) stamps[group] = op.id;
          answer = {
            ...current,
            serial: current.serial + 1,
            entry: next === undefined ? undefined : shared.options.clean(next),
            stamps,
            receipts: [...current.receipts, op.id].slice(-64),
          };
          store.put(answer);
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
    });
  }
  function start(id: string): Promise<void> {
    const active = running.get(id);
    if (active) return active;
    if (failures.has(id)) return Promise.reject(failures.get(id));
    const work = (async () => {
      const cold = !rows.has(id);
      await ensure(id);
      if (cold) {
        // The UI may edit before its first asynchronous restore. Preserve those
        // explicit patches, applying them over the just-read committed baseline.
        const stamps = { ...rows.get(id)!.stamps };
        for (const op of queues.get(id) ?? []) {
          if (op.kind === "edit") op.readToken.stamps = { ...stamps };
          if (
            op.kind === "edit" ||
            ((op.kind === "observe" || op.kind === "ack") &&
              equivalent(op.readToken.stamps, stamps))
          )
            for (const g of op.groups) stamps[g] = op.id;
        }
      }
      while (queues.get(id)?.length) {
        const op = queues.get(id)![0];
        if (
          (op.kind === "observe" || op.kind === "ack") &&
          !live(op.readToken)
        ) {
          shared.completions
            .get(op)
            ?.reject(
              new ThreadModelPersistenceError(
                "会话运行实例已改变，请重新发送。",
                "changed",
              ),
            );
          queues.get(id)!.shift();
          project(id);
          continue;
        }
        try {
          const row = await commit(id, op);
          rows.set(id, row);
          if (row.receipts.includes(op.id))
            shared.completions.get(op)?.resolve(row);
          else
            shared.completions
              .get(op)
              ?.reject(
                new ThreadModelPersistenceError(
                  "捕获的会话设置已失效，请重新发送。",
                  "changed",
                ),
              );
          queues.get(id)!.shift();
          project(id);
          shared.publish?.(id);
        } catch (error) {
          if (
            (op.kind === "observe" || op.kind === "ack") &&
            !live(op.readToken)
          ) {
            shared.completions
              .get(op)
              ?.reject(
                new ThreadModelPersistenceError(
                  "会话运行实例已改变，请重新发送。",
                  "changed",
                ),
              );
            queues.get(id)!.shift();
            project(id);
            continue;
          }
          throw error;
        }
      }
      queues.delete(id);
      status(id, { status: "ready" });
    })()
      .catch((error) => {
        for (const op of queues.get(id) ?? [])
          shared.completions.get(op)?.reject(error);
        throw failure(id, error);
      })
      .finally(() => {
        if (running.get(id) === work) running.delete(id);
      });
    running.set(id, work);
    return work;
  }
  function renewCompletion(op: SettingsIntent<P>) {
    let resolve!: Completion<E>["resolve"], reject!: Completion<E>["reject"];
    const promise = new Promise<SettingsRow<E>>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    shared.completions.set(op, { promise, resolve, reject });
  }
  function enqueue(
    id: string,
    input: Omit<SettingsIntent<P>, "id" | "readToken"> & {
      readToken?: ThreadModelReadToken;
    },
  ) {
    const op: SettingsIntent<P> = {
      ...input,
      id: uuid(),
      readToken: structuredClone(input.readToken ?? token(id)),
    };
    if (
      (op.kind === "observe" || op.kind === "ack") &&
      (!live(op.readToken) ||
        !equivalent(op.readToken.stamps, token(id).stamps))
    )
      return;
    if ((queues.get(id)?.length ?? 0) >= 64) {
      failure(
        id,
        new Error("待保存的会话设置过多，本次修改未接受；请先重试保存。"),
      );
      return;
    }
    const before = shared.options.get(id),
      after = shared.options.reduce(before, op);
    if (after === before || equivalent(after, before)) return;
    renewCompletion(op);
    queues.set(id, [...(queues.get(id) ?? []), op]);
    shared.options.apply(id, after);
    status(
      id,
      failures.has(id)
        ? {
            status:
              failures.get(id)!.kind === "conflict" ? "conflict" : "error",
            error: failures.get(id)!.message,
          }
        : { status: "saving" },
    );
    void start(id).catch(() => {});
  }
  async function flush(id: string): Promise<void> {
    await ensure(id);
    if (failures.has(id)) throw failures.get(id);
    while (queues.get(id)?.length || running.has(id)) await start(id);
    await ensure(id, true);
    if (failures.has(id)) throw failures.get(id);
  }
  function retry(id: string): Promise<void> {
    const previousWork = running.get(id);
    // A new attempt gets new completion promises, retaining operation IDs for
    // transaction deduplication. Older captured failures remain failures.
    for (const op of queues.get(id) ?? []) renewCompletion(op);
    failures.delete(id);
    let work!: Promise<void>;
    work = (async () => {
      await previousWork?.catch(() => {});
      const latest = await read(id);
      rows.set(id, latest);
      const stamps = { ...latest.stamps };
      for (const op of queues.get(id) ?? []) {
        if (op.kind === "edit")
          op.readToken = { ...token(id), stamps: { ...stamps } };
        if (op.kind !== "dismiss")
          for (const group of op.groups) stamps[group] = op.id;
      }
      project(id);
      if (running.get(id) === work) running.delete(id);
      await start(id);
    })()
      .catch((error) => {
        for (const op of queues.get(id) ?? [])
          shared.completions.get(op)?.reject(error);
        throw failure(id, error);
      })
      .finally(() => {
        if (running.get(id) === work) running.delete(id);
      });
    running.set(id, work);
    status(id, { status: "saving" });
    return work;
  }
  const refresh = () => {
    for (const id of rows.keys())
      if (!queues.get(id)?.length && !failures.has(id))
        void ensure(id, true).catch(() => {});
  };
  function connect() {
    if (
      disposed ||
      shared.options.connectEvents === false ||
      typeof window === "undefined"
    )
      return;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(name);
      channel.onmessage = ({ data }) => {
        if (
          data?.type === "changed" &&
          typeof data.threadId === "string" &&
          rows.has(data.threadId) &&
          !queues.get(data.threadId)?.length &&
          !failures.has(data.threadId)
        )
          void ensure(data.threadId, true).catch(() => {});
      };
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibleRefresh);
  }
  function visibleRefresh() {
    if (document.visibilityState === "visible") refresh();
  }
  function suspend() {
    channel?.close();
    channel = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    }
  }
  shared.publish = (id) =>
    channel?.postMessage({ type: "changed", threadId: id });
  connect();
  return {
    ensure,
    flush,
    retry,
    enqueue,
    token,
    captureBarrier(
      id: string,
      matchesBaseline: (entry: E | undefined) => boolean,
    ): Promise<void> {
      const prefix = [...(queues.get(id) ?? [])];
      if (failures.has(id)) return Promise.reject(failures.get(id));
      if (prefix.length)
        return Promise.all(
          prefix.map(
            (op) =>
              shared.completions.get(op)?.promise ??
              Promise.reject(
                new ThreadModelPersistenceError(
                  "等待此前设置保存后重新发送。",
                  "changed",
                ),
              ),
          ),
        ).then(() => {});
      // Cached empty/default values cannot prove that another page has not
      // committed an explicit same-value choice. Read one transaction snapshot,
      // and compare that row (not the projection containing later local edits).
      return read(id).then((row) => {
        const current = rows.get(id);
        if (!current || row.serial >= current.serial) {
          rows.set(id, row);
          project(id);
        }
        if (!queues.get(id)?.length && !failures.has(id))
          status(id, { status: "ready" });
        if (!matchesBaseline(row.entry))
          throw new ThreadModelPersistenceError(
            "已恢复此前保存的会话设置，请重新发送。",
            "changed",
          );
      });
    },
    handoff: shared,
    setScope(next: string | null) {
      if (shared.scope === next) return;
      shared.scope = next;
      shared.epoch++;
      for (const tx of nativeTransactions) {
        try {
          tx.abort();
        } catch {
          /* already settled */
        }
      }
      for (const id of rows.keys()) project(id);
    },
    async close() {
      disposed = true;
      suspend();
      await Promise.allSettled([...running.values(), ...loading.values()]);
      (await shared.connection?.catch(() => undefined))?.close();
    },
    /** Explicit test/controller lifecycle. Never selected by environment flags. */
    async reset() {
      await Promise.allSettled([...running.values(), ...loading.values()]);
      for (const pending of queues.values())
        for (const op of pending)
          shared.completions
            .get(op)
            ?.reject(
              new ThreadModelPersistenceError("设置控制器已重置。", "changed"),
            );
      rows.clear();
      queues.clear();
      failures.clear();
      (await shared.connection?.catch(() => undefined))?.close();
      shared.connection = undefined;
      if (factory)
        await new Promise<void>((resolve, reject) => {
          const request = factory.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("Settings reset blocked"));
        });
    },
    knownIds: () => [...rows.keys()],
    failure: (id: string) => failures.get(id),
    suspend,
    resume: connect,
  };
}
