import { nativeReasoningOptions } from "./nativeReasoningOptions";

/** Caller supplies the already eligible picker projection, never a raw catalog. */
export interface AlreadyEligiblePresetModel {
  readonly model: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly {
    readonly reasoningEffort: string;
    readonly description: string;
  }[];
}

export interface NativePowerChoice {
  id: string;
  model: string;
  modelLabel: string;
  reasoningEffort: string;
  powerSettingIndex: number;
}

type PresetPair = Pick<NativePowerChoice, "model" | "reasoningEffort">;

// Native pJr's built-in declarations. Dynamic slider configuration is a separate
// path; these fixed lists do not determine eligibility or enable production UI.
const PRIMARY: readonly PresetPair[] = [
  { model: "gpt-5.6-terra", reasoningEffort: "low" },
  { model: "gpt-5.6-sol", reasoningEffort: "low" },
  { model: "gpt-5.6-sol", reasoningEffort: "medium" },
  { model: "gpt-5.6-sol", reasoningEffort: "high" },
  { model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
  { model: "gpt-5.6-sol", reasoningEffort: "ultra" },
];
const SECONDARY: readonly PresetPair[] = [
  { model: "gpt-5.6-terra", reasoningEffort: "low" },
  { model: "gpt-5.6-terra", reasoningEffort: "medium" },
  { model: "gpt-5.6-terra", reasoningEffort: "high" },
  { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
];
const SOL_MODEL_PATTERN = /(?:^|[-_.])sol(?:$|[-_.])/iu;

// Native gMn with stripGptPrefix:true, reached by Main's real c_ import alias.
// This private presentation helper leaves canonical model identity untouched.
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

// Native vJr: preserve the declaration index, and find the first record that
// satisfies both canonical model and advertised effort, including duplicates.
function advertisedPairs(
  pairs: readonly PresetPair[],
  alreadyEligibleModels: readonly AlreadyEligiblePresetModel[],
): NativePowerChoice[] {
  return pairs.flatMap((pair, powerSettingIndex) => {
    const record = alreadyEligibleModels.find(
      (candidate) =>
        candidate.model === pair.model &&
        candidate.supportedReasoningEfforts.some(
          (option) => option.reasoningEffort === pair.reasoningEffort,
        ),
    );
    return record
      ? [{
          id: `${pair.model}:${pair.reasoningEffort}`,
          model: pair.model,
          modelLabel: modelLabel(record.displayName),
          reasoningEffort: pair.reasoningEffort,
          powerSettingIndex,
        }]
      : [];
  });
}

/** Exact built-in pJr branch: primary >=3, then secondary >=3, otherwise empty. */
export function deriveNativeBuiltinPresets(
  alreadyEligibleModels: readonly AlreadyEligiblePresetModel[],
): NativePowerChoice[] {
  const primary = advertisedPairs(PRIMARY, alreadyEligibleModels);
  if (primary.length >= 3) return primary;
  const secondary = advertisedPairs(SECONDARY, alreadyEligibleModels);
  return secondary.length >= 3 ? secondary : [];
}

/** Native gJr -> vJr; an unadvertised medium placeholder cannot become a choice. */
export function nativeAdvertisedModelChoices(
  alreadyEligibleModels: readonly AlreadyEligiblePresetModel[],
): NativePowerChoice[] {
  const pairs = alreadyEligibleModels.flatMap((record) => {
    const options = nativeReasoningOptions({
      supportedReasoningEfforts: [...record.supportedReasoningEfforts],
    });
    return (options.length > 0 ? options : ["medium"]).map(
      (reasoningEffort) => ({ model: record.model, reasoningEffort }),
    );
  });
  return advertisedPairs(pairs, alreadyEligibleModels);
}

/** Native TX/EX on explicit choices; preserves the selected object reference. */
export function nativeDefaultModelChoice<
  T extends Pick<NativePowerChoice, "id" | "model" | "reasoningEffort">,
>(choices: readonly T[], preferredId?: string): T | undefined {
  const preferredSuffix = preferredId?.slice(preferredId.lastIndexOf(":") + 1);
  return choices.find((choice) => choice.id === preferredId)
    ?? choices.find((choice) =>
      SOL_MODEL_PATTERN.test(choice.model)
      && choice.id.slice(choice.id.lastIndexOf(":") + 1) === preferredSuffix)
    ?? choices.find((choice) =>
      SOL_MODEL_PATTERN.test(choice.model) && choice.reasoningEffort === "medium")
    ?? choices.find((choice) => SOL_MODEL_PATTERN.test(choice.model))
    ?? choices.find((choice) => choice.reasoningEffort === "medium")
    ?? choices[0];
}
