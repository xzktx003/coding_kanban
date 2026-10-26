import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";
import { EffortSlider } from "@session/components/common/EffortSlider";
import {
  nativeDisplayReasoningEffort,
  nativeReasoningOptions,
} from "./nativeReasoningOptions";

export const GENERIC_REASONING_OPTIONS: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

// Returns the reasoning effort to apply, or undefined when the current one stays valid.
export function nextReasoningEffort(
  provider: string,
  modelId: string | undefined,
  current: ReasoningEffort | undefined,
  openAiModels: Model[],
): ReasoningEffort | undefined {
  if (provider === "openai") {
    const model = openAiModels.find((m) => m.id === modelId);
    // An unknown/typed model has no catalog evidence to override a preference.
    if (!model) return undefined;
    if (
      current &&
      model.supportedReasoningEfforts.some((o) => o.reasoningEffort === current)
    ) {
      return undefined;
    }
    return model.defaultReasoningEffort;
  }
  return current && GENERIC_REASONING_OPTIONS.includes(current)
    ? undefined
    : "medium";
}

type ReasoningEffortSelectorProps = {
  provider: string;
  // The selected model when the provider is openai; drives per-model options.
  openAiModel?: Model;
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
};

export function ReasoningEffortSelector({
  provider,
  openAiModel,
  value,
  onChange,
  disabled = false,
}: ReasoningEffortSelectorProps) {
  const options =
    provider === "openai"
      ? nativeReasoningOptions(openAiModel)
      : GENERIC_REASONING_OPTIONS;
  const displayedEffort =
    provider === "openai" && openAiModel
      ? nativeDisplayReasoningEffort(value, options)
      : value;

  return (
    <EffortSlider
      label="推理强度"
      options={options}
      value={displayedEffort}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
