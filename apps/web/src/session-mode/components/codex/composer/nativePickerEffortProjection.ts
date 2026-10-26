import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";

const NATIVE_WIRE_EFFORTS = new Set([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent",
]);

/** Ordinary non-Copilot FJr effort projection only. The caller supplies already
 * eligible records and explicit UI preferences/ultra visibility. This neither
 * filters model membership nor authorizes native or full-access operations.
 */
export function projectNativePickerEfforts(
  alreadyEligibleModels: readonly Model[],
  enabledReasoningEfforts: readonly ReasoningEffort[],
  includeUltra: boolean,
): Model[] {
  const enabled = new Set(enabledReasoningEfforts);
  enabled.add("persistent");
  return alreadyEligibleModels.map((model) => ({
    ...model,
    supportedReasoningEfforts: model.supportedReasoningEfforts.filter(({ reasoningEffort }) =>
      NATIVE_WIRE_EFFORTS.has(reasoningEffort) && enabled.has(reasoningEffort) &&
      (includeUltra || reasoningEffort !== "ultra")),
  }));
}
