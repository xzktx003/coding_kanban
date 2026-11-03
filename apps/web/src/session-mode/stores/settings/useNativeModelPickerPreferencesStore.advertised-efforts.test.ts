import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_NATIVE_PICKER_REASONING_EFFORTS,
  useNativeModelPickerPreferencesStore,
} from "./useNativeModelPickerPreferencesStore";

const KEY = "kanban.session.native-model-picker-preferences";
const LEGACY = ["low", "medium", "high", "xhigh", "ultra", "persistent"];
const NEXT = ["low", "medium", "high", "xhigh", "max", "ultra", "persistent"];

beforeEach(() => {
  localStorage.removeItem(KEY);
  vi.stubGlobal("fetch", () => {
    throw new Error("advertised-effort preference test must stay local");
  });
});
afterEach(() => {
  localStorage.removeItem(KEY);
  vi.unstubAllGlobals();
});

it("enables advertised max in the ordinary session default without inventing a picker preference", () => {
  expect([...DEFAULT_NATIVE_PICKER_REASONING_EFFORTS]).toEqual(NEXT);
  expect([...useNativeModelPickerPreferencesStore.getInitialState().enabledReasoningEfforts]).toEqual(NEXT);
});

it("upgrades only an exact saved legacy default and leaves a custom list unchanged", async () => {
  localStorage.setItem(KEY, JSON.stringify({
    version: 1,
    state: { selectionMode: "model", enabledReasoningEfforts: LEGACY },
  }));
  await useNativeModelPickerPreferencesStore.persist.rehydrate();
  expect(useNativeModelPickerPreferencesStore.getState().selectionMode).toBe("model");
  expect([...useNativeModelPickerPreferencesStore.getState().enabledReasoningEfforts]).toEqual(NEXT);

  localStorage.setItem(KEY, JSON.stringify({
    version: 1,
    state: { selectionMode: "default", enabledReasoningEfforts: ["low", "high"] },
  }));
  await useNativeModelPickerPreferencesStore.persist.rehydrate();
  expect(useNativeModelPickerPreferencesStore.getState().selectionMode).toBe("default");
  expect([...useNativeModelPickerPreferencesStore.getState().enabledReasoningEfforts]).toEqual(["low", "high"]);
});
