/**
 * Per-field `localStorage` persistence for same-device preferences.
 *
 * Zustand's `persist` wraps `api.setState` so that *every* setter re-serializes
 * the whole state map under a single key. Two browser pages on one machine share
 * one `localStorage`, so a page holding a stale map reverted every field it had
 * not touched. Giving each field its own key means only the fields a user
 * actually chose are written.
 *
 * Boundary: this is same-origin `localStorage` per-key write semantics, not
 * cross-device sync and not a compare-and-swap. Two pages writing the *same*
 * field still resolve to the last successful write. Stores needing a real
 * transaction (per-thread native settings) use `useThreadModelStore` instead.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `JSON.stringify` returns `undefined` for undefined; storage needs a string. */
export const encode = (value: unknown) => JSON.stringify(value) ?? "null";

export const oneOf =
  (...allowed: string[]) =>
  (value: unknown) =>
    typeof value === "string" && allowed.includes(value);

export interface PerFieldStorageOptions<T extends object> {
  /** The pre-split whole-map key. Read as a fallback, never written. */
  legacyKey: string;
  /** Bumped when the stored shape changes; also namespaces the per-field keys. */
  version: number;
  defaults: T;
  /**
   * A stored field is adopted only when it still matches the shape this build
   * understands; anything else falls back to the default rather than reaching
   * the UI as an unusable value.
   */
  validators: { [K in keyof T]: (value: unknown) => boolean };
  /** Applied in memory to the legacy map only, before its fields are read. */
  migrateLegacy?: (
    state: Record<string, unknown>,
    version: number,
  ) => Record<string, unknown>;
}

export function createPerFieldStorage<T extends object>({
  legacyKey,
  version,
  defaults,
  validators,
  migrateLegacy,
}: PerFieldStorageOptions<T>) {
  const prefix = `${legacyKey}.v${version}.`;
  const fields = Object.keys(defaults) as (keyof T)[];
  /** Fields whose write failed; a cross-page refresh must not drop them. */
  const unsaved = new Set<keyof T>();

  /**
   * The pre-split whole-state map, read-only and migrated in memory. Reading it
   * must never write it back: an old page still owns that key, and its next
   * write would resurrect stale values over a choice already saved here.
   */
  function legacyState(): Record<string, unknown> | undefined {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw) as { state?: unknown; version?: unknown };
      if (!isRecord(parsed?.state)) return undefined;
      const saved = parsed.state;
      const savedVersion =
        typeof parsed.version === "number" ? parsed.version : 0;
      return migrateLegacy ? migrateLegacy(saved, savedVersion) : saved;
    } catch {
      return undefined;
    }
  }

  function readField(
    field: keyof T,
    legacy: Record<string, unknown> | undefined,
  ) {
    try {
      const encoded = localStorage.getItem(prefix + String(field));
      if (encoded !== null) {
        const value = JSON.parse(encoded) as unknown;
        if (validators[field](value)) return value;
      }
    } catch {
      // An unreadable key is treated as absent, so one corrupt field cannot
      // throw past initialization and leave the whole surface without defaults.
    }
    const fallback = legacy?.[field as string];
    return validators[field](fallback) ? fallback : undefined;
  }

  function readAll(): T {
    const legacy = legacyState();
    const state = { ...defaults };
    for (const field of fields) {
      const value = readField(field, legacy);
      if (value !== undefined) Object.assign(state, { [field]: value });
    }
    return state;
  }

  function save(patch: Partial<T>) {
    for (const field of Object.keys(patch) as (keyof T)[]) {
      const value = patch[field];
      if (value === undefined) continue;
      try {
        // One atomic key write per explicit user choice. Other fields cannot be
        // lost through a stale page map; same-field conflicts use last write.
        localStorage.setItem(prefix + String(field), encode(value));
        unsaved.delete(field);
      } catch {
        unsaved.add(field);
      }
    }
  }

  /** Fields whose stored value differs from `current` and is safe to adopt. */
  function changes(current: T): Partial<T> {
    const stored = readAll();
    const patch: Partial<T> = {};
    for (const field of fields) {
      if (unsaved.has(field)) continue;
      if (encode(stored[field]) === encode(current[field])) continue;
      Object.assign(patch, { [field]: stored[field] });
    }
    return patch;
  }

  /** True for a key this store owns, or for a whole-storage clear (`null`). */
  const owns = (key: string | null) =>
    key === null ||
    key === legacyKey ||
    fields.some((field) => key === prefix + String(field));

  const clear = () => {
    for (const field of fields) localStorage.removeItem(prefix + String(field));
  };

  return { prefix, fields, readAll, save, changes, owns, clear };
}

/**
 * Adopt another page's choices as they are saved. The handler re-reads the
 * current keys rather than trusting a delayed event's `newValue`, which may
 * already be stale by the time it arrives.
 */
export function createStorageSync(
  refresh: () => void,
  owns: (key: string | null) => boolean,
) {
  let users = 0;

  function storageChanged(event: StorageEvent) {
    try {
      if (event.storageArea && event.storageArea !== localStorage) return;
    } catch {
      refresh();
      return;
    }
    if (owns(event.key)) refresh();
  }

  function detach() {
    if (typeof window === "undefined") return;
    users = 0;
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener("focus", refresh);
  }

  function start() {
    if (typeof window === "undefined") return () => {};
    if (users++ === 0) {
      window.addEventListener("storage", storageChanged);
      window.addEventListener("focus", refresh);
    }
    let stopped = false;
    return () => {
      if (stopped || !users) return;
      stopped = true;
      users--;
      if (!users) detach();
    };
  }

  return { start, detach };
}
