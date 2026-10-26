import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";

// Current main VSIX yC/dQ/gJr: persistent is a valid wire setting, but is
// excluded from picker choices. Keep the advertised order and raw catalog.
const PICKER_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

// Native bC/Pzt fallback for an absent canonical model. Commands and visible
// picker choices have separate pending/snapshot guards; the raw catalog stays intact.
export const NATIVE_UNKNOWN_REASONING_OPTIONS = Object.freeze<
  ReasoningEffort[]
>(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function nativeReasoningOptions(
  model: Pick<Model, "supportedReasoningEfforts"> | undefined,
): ReasoningEffort[] {
  return (
    model?.supportedReasoningEfforts
      .filter((option) => PICKER_REASONING_EFFORTS.has(option.reasoningEffort))
      .map((option) => option.reasoningEffort) ?? []
  );
}

// Native Z6r/JNn derives a medium display fallback; it does not repair the
// configured setting or publish a model/effort change while opening a picker.
export function nativeDisplayReasoningEffort(
  value: ReasoningEffort | null | undefined,
  options: readonly ReasoningEffort[],
): ReasoningEffort {
  return value != null &&
    PICKER_REASONING_EFFORTS.has(value) &&
    options.includes(value)
    ? value
    : "medium";
}

// Native hCa commands use bt=Z6r(raw, gt), then Q6r/$6r. Unlike the
// generic picker helper, a single advertised option may be an explicit change.
export function nativeReasoningCommand(
  options: readonly ReasoningEffort[],
  raw: ReasoningEffort | null | undefined,
  direction: 1 | -1,
  wrap: boolean,
): ReasoningEffort | null {
  const current = nativeDisplayReasoningEffort(raw, options);
  const index = options.indexOf(current);
  const nextIndex = wrap
    ? index === options.length - 1 ? 0 : index + 1
    : direction > 0 ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0);
  const next = options[nextIndex] ?? current;
  return next === current ? null : next;
}

type NativeMenuModel = Pick<
  Model,
  "model" | "isDefault" | "defaultReasoningEffort" | "supportedReasoningEfforts"
>;

const SOL_MODEL_PATTERN = /(?:^|[-_.])sol(?:$|[-_.])/iu;

// Ordinary hCa current-model projection: selected (model, bt), then TX's
// preferred/Sol/medium/first fallback. This does not build cross-model presets.
export function nativeMenuReasoningEffort(
  raw: ReasoningEffort | null | undefined,
  model: NativeMenuModel,
  catalog: readonly NativeMenuModel[],
): ReasoningEffort | null {
  const options = nativeReasoningOptions(model);
  const current = nativeDisplayReasoningEffort(raw, options);
  if (options.includes(current)) return current;
  const powers = options.map((reasoningEffort) => ({
    id: `${model.model}:${reasoningEffort}`,
    model: model.model,
    reasoningEffort,
  }));
  const preferred = catalog.find((item) => item.isDefault);
  const preferredId = preferred
    ? `${preferred.model}:${preferred.defaultReasoningEffort}`
    : undefined;
  const preferredSuffix = preferredId?.slice(preferredId.lastIndexOf(":") + 1);
  const fallback =
    powers.find((power) => power.id === preferredId) ??
    powers.find(
      (power) =>
        SOL_MODEL_PATTERN.test(power.model) &&
        power.id.slice(power.id.lastIndexOf(":") + 1) === preferredSuffix,
    ) ??
    powers.find(
      (power) =>
        SOL_MODEL_PATTERN.test(power.model) &&
        power.reasoningEffort === "medium",
    ) ??
    powers.find((power) => SOL_MODEL_PATTERN.test(power.model)) ??
    powers.find((power) => power.reasoningEffort === "medium") ??
    powers[0];
  return fallback?.reasoningEffort ?? null;
}
