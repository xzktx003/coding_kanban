import type {
  AlreadyEligiblePresetModel,
  NativePowerChoice,
} from "./nativeBuiltinModelPresets";
import { nativeReasoningOptions } from "./nativeReasoningOptions";

// Native gMn with stripGptPrefix:true, identical to the C preset label helper.
function modelLabel(value: string): string {
  if (!value.trimStart().toLowerCase().startsWith("gpt")) return value;
  const separator = /^gpt-\d/iu.test(value.trimStart()) ? " " : "-";
  return value
    .split(/(\s+)/)
    .map((part) =>
      part.trim().length === 0
        ? part
        : part
            .split("-")
            .map((word, index) =>
              word.toLowerCase() === "gpt"
                ? "GPT"
                : word.toLowerCase() === "oai"
                  ? "OAI"
                  : index > 0 && word.length > 0
                    ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
                    : word,
            )
            .join(separator)
            .replace(/^GPT (?=\d)/u, "GPT-"),
    )
    .join("")
    .replace(/^GPT-/iu, "");
}

/** Ordinary gJr current-model slice, followed by yCa's compact index.
 * Caller has already projected display choices; this is not native eligibility.
 * Empty recognized options retain gJr's unadvertised medium placeholder.
 */
export function nativePickerModelPowerChoices(
  models: readonly AlreadyEligiblePresetModel[],
  currentModel: string,
): NativePowerChoice[] {
  return models
    .filter((record) => record.model === currentModel)
    .flatMap((record) => {
      const options = nativeReasoningOptions({
        supportedReasoningEfforts: [...record.supportedReasoningEfforts],
      });
      return (options.length > 0 ? options : ["medium"]).map(
        (reasoningEffort) => ({
          id: `${record.model}:${reasoningEffort}`,
          model: record.model,
          modelLabel: modelLabel(record.displayName),
          reasoningEffort,
        }),
      );
    })
    .map((choice, powerSettingIndex) => ({ ...choice, powerSettingIndex }));
}
