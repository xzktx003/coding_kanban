import { useMemo, useSyncExternalStore } from "react";
import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";
import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { projectNativePickerEfforts } from "./nativePickerEffortProjection";

const EMPTY_PREFERENCES: readonly ReasoningEffort[] = Object.freeze([]);
const readEmptyPreferences = () => EMPTY_PREFERENCES;
const subscribeToNothing = () => () => {};
const readPreferences = () =>
  useNativeModelPickerPreferencesStore.getState().enabledReasoningEfforts;

// This app has no source for the official 1186680773 rollout. Ordinary UI
// rendering uses an explicit local display policy with ultra hidden; this
// neither identifies the native auth method nor changes native permissions.
function projectModels(
  rawModels: readonly Model[],
  enabled: readonly ReasoningEffort[],
): Model[] {
  return projectNativePickerEfforts(rawModels, enabled, false);
}

/** Read current preferences at the command event, within its existing owner guard. */
export function getOrdinaryNativePickerModels(rawModels: readonly Model[]): Model[] {
  return projectModels(rawModels, readPreferences());
}

/** Ordinary app surfaces share the same projection; generic surfaces keep raw
 * records and do not subscribe to this preference store. No model state repair.
 */
export function useOrdinaryNativePickerModels(
  rawModels: readonly Model[],
  active: boolean,
): readonly Model[] {
  const enabled = useSyncExternalStore(
    active ? useNativeModelPickerPreferencesStore.subscribe : subscribeToNothing,
    active ? readPreferences : readEmptyPreferences,
    active ? readPreferences : readEmptyPreferences,
  );
  return useMemo(
    () => active ? projectModels(rawModels, enabled) : rawModels,
    [rawModels, enabled, active],
  );
}
