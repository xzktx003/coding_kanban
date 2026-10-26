import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReasoningEffort } from "@session/bindings";

export type NativeModelPickerSelectionMode = null | "default" | "model";

/** Main Yb/hAt preference defaults. This is this app's own origin/device state,
 * separate from native configuration, model intent and each menu's local view.
 */
export const DEFAULT_NATIVE_PICKER_REASONING_EFFORTS: readonly ReasoningEffort[] =
  Object.freeze(["low", "medium", "high", "xhigh", "ultra", "persistent"]);

export interface NativeModelPickerPreferencesState {
  selectionMode: NativeModelPickerSelectionMode;
  enabledReasoningEfforts: readonly ReasoningEffort[];
  setSelectionMode: (mode: NativeModelPickerSelectionMode) => void;
  setEnabledReasoningEfforts: (efforts: readonly ReasoningEffort[]) => void;
}

type PersistedPreferences = Partial<Pick<
  NativeModelPickerPreferencesState,
  "selectionMode" | "enabledReasoningEfforts"
>>;

const RECOGNIZED_EFFORTS = new Set([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
]);

function selectionMode(value: unknown): value is NativeModelPickerSelectionMode {
  return value === null || value === "default" || value === "model";
}

function efforts(value: unknown): value is readonly ReasoningEffort[] {
  if (!Array.isArray(value)) return false;
  // for..of also rejects sparse slots, which Array.every would skip.
  for (const item of value) {
    if (typeof item !== "string" || !RECOGNIZED_EFFORTS.has(item)) return false;
  }
  return true;
}

function equalEfforts(left: readonly ReasoningEffort[], right: readonly ReasoningEffort[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mergePreferences(
  persisted: unknown,
  current: NativeModelPickerPreferencesState,
): NativeModelPickerPreferencesState {
  if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) return current;
  const value = persisted as Record<string, unknown>;
  const mode = Object.prototype.hasOwnProperty.call(value, "selectionMode") && selectionMode(value.selectionMode)
    ? value.selectionMode : current.selectionMode;
  let enabled = current.enabledReasoningEfforts;
  if (Object.prototype.hasOwnProperty.call(value, "enabledReasoningEfforts") && efforts(value.enabledReasoningEfforts) &&
      !equalEfforts(enabled, value.enabledReasoningEfforts)) {
    enabled = Object.freeze([...value.enabledReasoningEfforts]);
  }
  return mode === current.selectionMode && enabled === current.enabledReasoningEfforts
    ? current : { ...current, selectionMode: mode, enabledReasoningEfforts: enabled };
}

export const useNativeModelPickerPreferencesStore = create<NativeModelPickerPreferencesState>()(
  persist<NativeModelPickerPreferencesState, [], [], PersistedPreferences>(
    (set) => ({
      selectionMode: null,
      enabledReasoningEfforts: DEFAULT_NATIVE_PICKER_REASONING_EFFORTS,
      setSelectionMode: (mode) => {
        if (!selectionMode(mode)) throw new TypeError("Invalid native picker selection mode");
        set((state) => state.selectionMode === mode ? state : { selectionMode: mode });
      },
      setEnabledReasoningEfforts: (enabled) => {
        if (!efforts(enabled)) throw new TypeError("Invalid native picker reasoning efforts");
        set((state) => equalEfforts(state.enabledReasoningEfforts, enabled)
          ? state : { enabledReasoningEfforts: Object.freeze([...enabled]) });
      },
    }),
    {
      name: "kanban.session.native-model-picker-preferences",
      version: 1,
      partialize: ({ selectionMode, enabledReasoningEfforts }) => ({ selectionMode, enabledReasoningEfforts }),
      // Zustand invokes migration for a different numeric version. A missing
      // or nonnumeric version still enters the same whitelisted field merge.
      migrate: () => ({}),
      merge: mergePreferences,
    },
  ),
);
