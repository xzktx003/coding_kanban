import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";
import type { ModelListItem } from "@session/components/codex/types";

/** Ordinary native selection uses Model.model; the raw catalog id is retained. */
export function canonicalNativeModel(
  models: readonly Model[],
  selected: string | undefined,
): Model | undefined {
  return models.find((record) => record.model === selected);
}

export function canonicalNativeItems(models: readonly Model[]): ModelListItem[] {
  return models.map((record) => ({
    id: record.model,
    label: record.displayName || record.model,
    description: record.description,
  }));
}

/** Preserve the existing effort/default policy using the selected native record. */
export function nextEffortForNativeRecord(
  target: Model | undefined,
  current: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!target) return undefined;
  if (
    current &&
    target.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === current,
    )
  )
    return undefined;
  return target.defaultReasoningEffort;
}
