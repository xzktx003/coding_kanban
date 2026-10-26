import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import {
  NATIVE_UNKNOWN_REASONING_OPTIONS,
  nativeDisplayReasoningEffort,
  nativeReasoningCommand,
  nativeReasoningOptions,
} from "@session/components/codex/composer/nativeReasoningOptions";

type SelectionMode = null | "default" | "model";
type PreferenceState = {
  selectionMode: SelectionMode;
  enabledReasoningEfforts: readonly ReasoningEffort[];
  setSelectionMode(mode: SelectionMode): void;
  setEnabledReasoningEfforts(efforts: readonly ReasoningEffort[]): void;
};
type PreferenceStore = {
  getState(): PreferenceState;
  getInitialState(): PreferenceState;
  subscribe(listener: (state: PreferenceState, previous: PreferenceState) => void): () => void;
  persist: {
    getOptions(): { name?: string; version?: number };
    rehydrate(): Promise<unknown> | void;
  };
};
const SUBJECT_MODULES = import.meta.glob<Record<string, unknown>>("./useNativeModelPickerPreferencesStore.ts");
const KEY = "kanban.session.native-model-picker-preferences";
const DEFAULT = ["low", "medium", "high", "xhigh", "ultra", "persistent"];
const ALL = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const FOREIGN_KEYS = [
  "codex:persisted-atom:composer-model-picker-selection-mode-v1",
  "kanban.session.model-settings",
  "kanban.session.codex-config-storage",
  "kanban.session.codex-thread-models",
];
const forbiddenFetch = vi.fn(() => { throw Error("E1_UNEXPECTED_NETWORK"); });
const forbiddenWebSocket = vi.fn(() => { throw Error("E1_UNEXPECTED_WEBSOCKET"); });

async function actualStore(): Promise<PreferenceStore> {
  // Absence fails this explicit API-availability assertion, never a missing-module import.
  const loader = SUBJECT_MODULES["./useNativeModelPickerPreferencesStore.ts"];
  expect(typeof loader, "new E1 store module must exist (availability only)").toBe("function");
  if (typeof loader !== "function") throw Error("E1_STORE_API_UNAVAILABLE");
  const module = await loader();
  const value = Reflect.get(module, "useNativeModelPickerPreferencesStore");
  expect(typeof value, "new E1 public store must exist (availability only)").toBe("function");
  const store = value as unknown as PreferenceStore;
  expect(typeof store.getState).toBe("function");
  expect(typeof store.getState().setSelectionMode).toBe("function");
  expect(typeof store.getState().setEnabledReasoningEfforts).toBe("function");
  return store;
}
async function freshStore(): Promise<PreferenceStore> {
  const store = await actualStore();
  store.getState().setSelectionMode(null);
  store.getState().setEnabledReasoningEfforts(DEFAULT);
  localStorage.removeItem(KEY);
  return store;
}
async function hydrateOwn(store: PreferenceStore, state: unknown, version: unknown = 1): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
  await store.persist.rehydrate();
}
function data(state: PreferenceState) {
  return { selectionMode: state.selectionMode, enabledReasoningEfforts: [...state.enabledReasoningEfforts] };
}
function expectMethods(store: PreferenceStore, previous: PreferenceState) {
  expect(store.getState().setSelectionMode).toBe(previous.setSelectionMode);
  expect(store.getState().setEnabledReasoningEfforts).toBe(previous.setEnabledReasoningEfforts);
}
beforeEach(() => {
  localStorage.removeItem(KEY);
  for (const key of FOREIGN_KEYS) localStorage.removeItem(key);
  forbiddenFetch.mockClear(); forbiddenWebSocket.mockClear();
  vi.stubGlobal("fetch", forbiddenFetch);
  vi.stubGlobal("WebSocket", forbiddenWebSocket);
});
afterEach(() => {
  try {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(forbiddenWebSocket).not.toHaveBeenCalled();
  } finally {
    localStorage.removeItem(KEY);
    for (const key of FOREIGN_KEYS) localStorage.removeItem(key);
    vi.unstubAllGlobals();
  }
});

it("exposes the new public API with exact hAt defaults and only two data fields", async () => {
  const store = await actualStore(), initial = store.getInitialState();
  expect(data(initial)).toEqual({ selectionMode: null, enabledReasoningEfforts: DEFAULT });
  expect(Object.isFrozen(initial.enabledReasoningEfforts)).toBe(true);
  expect(Object.keys(initial).sort()).toEqual([
    "enabledReasoningEfforts", "selectionMode", "setEnabledReasoningEfforts", "setSelectionMode",
  ]);
  expect(store.persist.getOptions()).toMatchObject({ name: KEY, version: 1 });
  expect(data(store.getState())).toEqual({ selectionMode: null, enabledReasoningEfforts: DEFAULT });
});

it("changes only selectionMode and keeps same-mode state identity and subscribers quiet", async () => {
  const store = await freshStore(), notify = vi.fn(), off = store.subscribe(notify);
  try {
    let previous = store.getState();
    previous.setSelectionMode(null);
    expect(store.getState()).toBe(previous); expect(notify).not.toHaveBeenCalled();
    let count = 0;
    for (const mode of ["default", "model", null] as const) {
      const efforts = previous.enabledReasoningEfforts;
      store.getState().setSelectionMode(mode); count += 1;
      const changed = store.getState();
      expect(changed.selectionMode).toBe(mode);
      expect(changed.enabledReasoningEfforts).toBe(efforts);
      expect(notify).toHaveBeenCalledTimes(count);
      changed.setSelectionMode(mode);
      expect(store.getState()).toBe(changed); expect(notify).toHaveBeenCalledTimes(count);
      previous = changed;
    }
  } finally { off(); }
});

it("accepts all nine wire values and preserves duplicate order in a separate frozen clone", async () => {
  const store = await freshStore(), input = [...ALL, "high", "none"], expected = [...input];
  store.getState().setEnabledReasoningEfforts(input);
  const current = store.getState().enabledReasoningEfforts;
  expect(current).toEqual(expected); expect(current).not.toBe(input);
  expect(Object.isFrozen(current)).toBe(true); expect(Object.isFrozen(input)).toBe(false);
  input[0] = "max"; input.push("low");
  expect(current).toEqual(expected); expect(store.getState().selectionMode).toBeNull();
  store.getState().setEnabledReasoningEfforts([]);
  expect(store.getState().enabledReasoningEfforts).toEqual([]);
  expect(Object.isFrozen(store.getState().enabledReasoningEfforts)).toBe(true);
});

it("suppresses equal-array state notifications without deduplicating or sorting changed arrays", async () => {
  const store = await freshStore(), notify = vi.fn(), off = store.subscribe(notify);
  try {
    const before = store.getState(), efforts = before.enabledReasoningEfforts;
    before.setEnabledReasoningEfforts([...DEFAULT]);
    expect(store.getState()).toBe(before);
    expect(store.getState().enabledReasoningEfforts).toBe(efforts);
    expect(notify).not.toHaveBeenCalled();
    store.getState().setEnabledReasoningEfforts(["high", "low", "high"]);
    const changed = store.getState();
    expect(changed.enabledReasoningEfforts).toEqual(["high", "low", "high"]);
    expect(notify).toHaveBeenCalledTimes(1);
    changed.setEnabledReasoningEfforts(Object.freeze(["high", "low", "high"]));
    expect(store.getState()).toBe(changed); expect(notify).toHaveBeenCalledTimes(1);
  } finally { off(); }
});

it("rejects invalid selectionMode inputs with TypeError before any state update", async () => {
  const store = await freshStore(), before = store.getState(), notify = vi.fn(), off = store.subscribe(notify);
  try {
    for (const invalid of [undefined, false, 0, "simple", "Default", " model", "model ", {}]) {
      expect(() => Reflect.apply(before.setSelectionMode, undefined, [invalid])).toThrow(TypeError);
      expect(store.getState()).toBe(before);
    }
    expect(notify).not.toHaveBeenCalled();
  } finally { off(); }
});

it("rejects invalid whole arrays and invalid members atomically instead of filtering them", async () => {
  const store = await freshStore(), before = store.getState(), notify = vi.fn(), off = store.subscribe(notify);
  try {
    for (const invalid of [undefined, null, "low", {}, [null], ["low", "future-effort"], ["Low"], [" low"], new Array(1)]) {
      expect(() => Reflect.apply(before.setEnabledReasoningEfforts, undefined, [invalid])).toThrow(TypeError);
      expect(store.getState()).toBe(before);
    }
    expect(notify).not.toHaveBeenCalled();
  } finally { off(); }
});

it("roundtrips through real Zustand persist and localStorage with only the two data fields", async () => {
  const store = await freshStore();
  store.getState().setSelectionMode("model");
  store.getState().setEnabledReasoningEfforts(["none", "persistent", "max", "none"]);
  const saved = localStorage.getItem(KEY);
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!)).toEqual({ version: 1, state: {
    selectionMode: "model", enabledReasoningEfforts: ["none", "persistent", "max", "none"],
  } });
  store.getState().setSelectionMode(null); store.getState().setEnabledReasoningEfforts(DEFAULT);
  localStorage.setItem(KEY, saved!); await store.persist.rehydrate();
  expect(data(store.getState())).toEqual({
    selectionMode: "model", enabledReasoningEfforts: ["none", "persistent", "max", "none"],
  });
  expect(Object.isFrozen(store.getState().enabledReasoningEfforts)).toBe(true);
});

it("rehydrates only whitelisted fields and cannot replace setters or attach unknown data", async () => {
  const store = await freshStore(), before = store.getState();
  await hydrateOwn(store, {
    selectionMode: "default", enabledReasoningEfforts: ["max", "none", "max"],
    setSelectionMode: "persisted method", setEnabledReasoningEfforts: "persisted method",
    menuView: "advanced", model: "foreign-model", threadId: "foreign-thread",
  });
  expect(data(store.getState())).toEqual({ selectionMode: "default", enabledReasoningEfforts: ["max", "none", "max"] });
  expect(Object.keys(store.getState()).sort()).toEqual(Object.keys(before).sort());
  expectMethods(store, before); expect(Object.isFrozen(store.getState().enabledReasoningEfforts)).toBe(true);
});

it("merges independent valid fields while missing or malformed fields preserve live values", async () => {
  const store = await freshStore();
  store.getState().setSelectionMode("model"); store.getState().setEnabledReasoningEfforts(["high", "low", "high"]);
  let before = store.getState();
  await hydrateOwn(store, { selectionMode: "default", enabledReasoningEfforts: ["low", 7] });
  expect(store.getState().selectionMode).toBe("default");
  expect(store.getState().enabledReasoningEfforts).toBe(before.enabledReasoningEfforts);
  before = store.getState();
  await hydrateOwn(store, { selectionMode: "advanced", enabledReasoningEfforts: ["none", "max"] });
  expect(store.getState().selectionMode).toBe("default");
  expect(store.getState().enabledReasoningEfforts).toEqual(["none", "max"]); expectMethods(store, before);
  before = store.getState();
  await hydrateOwn(store, { selectionMode: null });
  expect(store.getState().selectionMode).toBeNull();
  expect(store.getState().enabledReasoningEfforts).toBe(before.enabledReasoningEfforts);
  await hydrateOwn(store, { enabledReasoningEfforts: [] });
  expect(data(store.getState())).toEqual({ selectionMode: null, enabledReasoningEfforts: [] });
});

it("preserves live preferences for malformed whole persisted states", async () => {
  const store = await freshStore();
  store.getState().setSelectionMode("model"); store.getState().setEnabledReasoningEfforts(["high", "high"]);
  for (const malformed of [null, "model", 42, true, ["low"]]) {
    const before = store.getState(); await hydrateOwn(store, malformed);
    expect(data(store.getState())).toEqual({ selectionMode: "model", enabledReasoningEfforts: ["high", "high"] });
    expect(store.getState().enabledReasoningEfforts).toBe(before.enabledReasoningEfforts); expectMethods(store, before);
  }
});

it("ignores numeric versions different from one through real persist migration", async () => {
  const store = await freshStore();
  store.getState().setSelectionMode("model"); store.getState().setEnabledReasoningEfforts(["high"]);
  for (const version of [0, 2, 99]) {
    const before = store.getState();
    await hydrateOwn(store, { selectionMode: "default", enabledReasoningEfforts: ["max"] }, version);
    expect(data(store.getState())).toEqual({ selectionMode: "model", enabledReasoningEfforts: ["high"] });
    expect(store.getState().enabledReasoningEfforts).toBe(before.enabledReasoningEfforts); expectMethods(store, before);
  }
});

it("follows real middleware for versionless and nonnumeric own envelopes but still whitelists fields", async () => {
  const store = await freshStore();
  for (const version of [undefined, "unrecognized-version", null]) {
    store.getState().setSelectionMode("model"); store.getState().setEnabledReasoningEfforts(["high"]);
    const before = store.getState();
    // Set the envelope directly: helper's default parameter must not turn undefined into version1.
    localStorage.setItem(KEY, JSON.stringify({ state: {
      selectionMode: "default", enabledReasoningEfforts: ["max", "none"], menuView: "advanced",
    }, version }));
    await store.persist.rehydrate();
    expect(data(store.getState())).toEqual({ selectionMode: "default", enabledReasoningEfforts: ["max", "none"] });
    expect(Object.keys(store.getState()).sort()).toEqual(Object.keys(before).sort()); expectMethods(store, before);
  }
});

it("does not import other keys or perform application reads when creating, changing, or rehydrating own preferences", async () => {
  const values = FOREIGN_KEYS.map((key, index) => [key, JSON.stringify({ state: {
    selectionMode: "model", enabledReasoningEfforts: ["max"], foreignIndex: index,
  }, version: 1 })] as const);
  for (const [key, value] of values) localStorage.setItem(key, value);
  // Spies forward to real jsdom storage; no replacement payload or store implementation.
  const reads = vi.spyOn(Storage.prototype, "getItem");
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const removals = vi.spyOn(Storage.prototype, "removeItem");
  try {
    vi.resetModules(); // Re-evaluate the actual subject with synthetic storage, never a store mock.
    const store = await actualStore();
    expect(data(store.getState())).toEqual({ selectionMode: null, enabledReasoningEfforts: DEFAULT });
    await store.persist.rehydrate();
    expect(data(store.getState())).toEqual({ selectionMode: null, enabledReasoningEfforts: DEFAULT });
    store.getState().setSelectionMode("default"); store.getState().setEnabledReasoningEfforts(["minimal", "max"]);
    expect(reads).toHaveBeenCalled(); expect(writes).toHaveBeenCalled();
    expect(reads.mock.calls.every(([key]) => key === KEY)).toBe(true);
    expect(writes.mock.calls.every(([key]) => key === KEY)).toBe(true);
    expect(removals.mock.calls.every(([key]) => key === KEY)).toBe(true);
    // Read test sentinels only after checking calls caused by the actual subject.
    for (const [key, value] of values) expect(localStorage.getItem(key)).toBe(value);
    expect(forbiddenFetch).not.toHaveBeenCalled(); expect(forbiddenWebSocket).not.toHaveBeenCalled();
  } finally { reads.mockRestore(); writes.mockRestore(); removals.mockRestore(); }
});

// This existing-helper control never loads the proposed store, even on the old implementation.
it("keeps existing pure wire/display/command behavior independent from the proposed preference store", () => {
  const model = { supportedReasoningEfforts: ["none", "persistent", "low", "max", "ultra", "low"].map(reasoningEffort => ({ reasoningEffort, description: "synthetic control" })) };
  const before = structuredClone(model);
  expect(nativeReasoningOptions(model)).toEqual(["none", "low", "max", "ultra", "low"]);
  expect(NATIVE_UNKNOWN_REASONING_OPTIONS).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  expect(nativeDisplayReasoningEffort("persistent", ["low", "high"])).toBe("medium");
  expect(nativeReasoningCommand(["low"], null, 1, false)).toBe("low");
  expect(model).toEqual(before);
});
