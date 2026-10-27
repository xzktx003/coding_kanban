import { create } from "zustand";

export type EnterBehavior = "enter" | "cmdIfMultiline" | "cmdAlways";
interface Preferences {
  mode: "queue" | "steer";
  enterBehavior: EnterBehavior;
  reviewDelivery: "inline" | "detached";
}
type Field = keyof Preferences;
type Errors = Partial<Record<Field, string>>;
interface FollowupSettings extends Preferences {
  persistenceError: string | null;
  retryPersistence(): void;
  setMode(mode: Preferences["mode"]): void;
  setEnterBehavior(value: EnterBehavior): void;
  setReviewDelivery(value: Preferences["reviewDelivery"]): void;
}
const LEGACY_KEY = "kanban.session.followup-settings";
const PREFIX = `${LEGACY_KEY}.v1.`;
const defaults: Preferences = {
  mode: "queue",
  enterBehavior: "enter",
  reviewDelivery: "inline",
};
const choices = {
  mode: ["queue", "steer"],
  enterBehavior: ["enter", "cmdIfMultiline", "cmdAlways"],
  reviewDelivery: ["inline", "detached"],
};
const fields = Object.keys(defaults) as Field[];
const valid = (field: Field, value: unknown): value is Preferences[Field] =>
  typeof value === "string" && choices[field].includes(value);
type Handoff = {
  values?: Partial<Preferences>;
  pending: Partial<Preferences>;
  errors: Errors;
  successor?: { choose: typeof choose; retry: typeof retry };
};
const inherited = import.meta.hot?.data?.followupPreferences as
  | Handoff
  | undefined;
// At most three current unsaved choices; never a snapshot history or operation log.
const route: Handoff = inherited ?? { pending: {}, errors: {} };
const pending = route.pending;
const errors = route.errors;
let disposed = false;
let syncUsers = 0;

function read(field: Field): Preferences[Field] | undefined {
  try {
    const encoded = localStorage.getItem(PREFIX + field);
    let value: unknown;
    if (encoded !== null) {
      value = JSON.parse(encoded);
    } else {
      // Read-only legacy fallback: initialization never writes a stale whole map.
      const legacy = localStorage.getItem(LEGACY_KEY);
      const state = legacy === null ? undefined : JSON.parse(legacy)?.state;
      if (
        legacy !== null &&
        (!state || typeof state !== "object" || Array.isArray(state))
      )
        throw new Error("旧偏好格式无效");
      value = state?.[field] ?? defaults[field];
    }
    if (!valid(field, value)) throw new Error("偏好值格式无效");
    delete errors[field];
    return value;
  } catch (error) {
    errors[field] =
      `偏好读取失败：${error instanceof Error ? error.message : String(error)}`;
    return undefined;
  }
}
function errorMessage() {
  return (
    [...new Set(fields.map((field) => errors[field]).filter(Boolean))].join(
      "；",
    ) || null
  );
}
function refresh() {
  if (disposed) return;
  const patch: Partial<Preferences> = {};
  for (const field of fields) {
    if (pending[field] !== undefined) continue;
    const value = read(field);
    if (value !== undefined) Object.assign(patch, { [field]: value });
  }
  publish(patch);
}
function publish(patch: Partial<Preferences>) {
  route.values = { ...route.values, ...patch };
  if (disposed) return;
  const persistenceError = errorMessage();
  useFollowupSettingsStore.setState((current) =>
    fields.every(
      (field) => patch[field] === undefined || patch[field] === current[field],
    ) && persistenceError === current.persistenceError
      ? current
      : { ...patch, persistenceError },
  );
}
function choose(field: Field, value: Preferences[Field]): void {
  if (disposed && route.successor) return route.successor.choose(field, value);
  if (!valid(field, value)) return;
  Object.assign(pending, { [field]: value });
  try {
    // One atomic key write per explicit user choice. Other fields cannot be lost
    // through a stale page map; same-field conflicts use last successful write.
    localStorage.setItem(PREFIX + field, JSON.stringify(value));
    delete pending[field];
    delete errors[field];
  } catch (error) {
    errors[field] =
      `偏好未保存：${error instanceof Error ? error.message : String(error)}`;
  }
  publish({ [field]: value });
}
function retry(): void {
  if (disposed && route.successor) return route.successor.retry();
  for (const field of fields) {
    const value = pending[field];
    if (value !== undefined) choose(field, value);
  }
  refresh();
}
const initial: Preferences = { ...defaults, ...route.values };
for (const field of fields) {
  const value = pending[field] ?? read(field);
  if (value !== undefined) Object.assign(initial, { [field]: value });
}
route.values = initial;
export const useFollowupSettingsStore = create<FollowupSettings>(() => ({
  ...initial,
  persistenceError: errorMessage(),
  retryPersistence: retry,
  setMode: (value) => choose("mode", value),
  setEnterBehavior: (value) => choose("enterBehavior", value),
  setReviewDelivery: (value) => choose("reviewDelivery", value),
}));
route.successor = { choose, retry };
function storageChanged(event: StorageEvent) {
  try {
    if (event.storageArea && event.storageArea !== localStorage) return;
  } catch {
    refresh();
    return;
  }
  if (
    event.key === null ||
    event.key === LEGACY_KEY ||
    fields.some((field) => event.key === PREFIX + field)
  ) {
    // Read the current keys, never apply a delayed event's stale newValue.
    refresh();
  }
}
function detachSync() {
  if (typeof window === "undefined") return;
  syncUsers = 0;
  window.removeEventListener("storage", storageChanged);
  window.removeEventListener("focus", refresh);
}
export function startFollowupSettingsSync() {
  if (disposed || typeof window === "undefined") return () => {};
  if (syncUsers++ === 0) {
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refresh);
  }
  let stopped = false;
  return () => {
    if (stopped || !syncUsers) return;
    stopped = true;
    syncUsers--;
    if (!syncUsers) detachSync();
  };
}
import.meta.hot?.dispose((data) => {
  disposed = true;
  route.successor = undefined;
  detachSync();
  data.followupPreferences = route;
});
