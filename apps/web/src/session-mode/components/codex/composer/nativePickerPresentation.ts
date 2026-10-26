import {
  deriveNativeBuiltinPresets,
  nativeAdvertisedModelChoices,
  nativeDefaultModelChoice,
  type AlreadyEligiblePresetModel,
  type NativePowerChoice,
} from "./nativeBuiltinModelPresets";

export type NativePickerSelectionMode = "default" | "model";

export interface NativePickerDefaultModel {
  readonly model: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
}

export interface NativePickerPresentationInput {
  /** Full ordinary display projection (ke), before disabled rows are excluded. */
  readonly models: readonly NativePickerDefaultModel[];
  /** Same-source selectable preset projection (vt); caller has already projected it.
   * This is an input contract, not proof of native eligibility or permission.
   */
  readonly presetModels: readonly AlreadyEligiblePresetModel[];
  readonly current: {
    readonly model: string;
    /** hCa bt = Z6r(raw effort, current-model gt), not raw or menu TX fallback. */
    readonly displayReasoningEffort: string;
  };
  readonly savedSelectionMode: NativePickerSelectionMode | null;
}

export interface NativePickerPresentation {
  readonly presets: readonly NativePowerChoice[];
  readonly advertisedChoices: readonly NativePowerChoice[];
  /** Exact first-isDefault input object, even if it has no built-in preset. */
  readonly preferredModel: NativePickerDefaultModel | undefined;
  /** Exact object from presets, or undefined when presets is empty. */
  readonly defaultChoice: NativePowerChoice | undefined;
  readonly selectedPreset: NativePowerChoice | undefined;
  readonly effectiveSelectionMode: NativePickerSelectionMode;
  /** Data only: consume solely on a real admitted first open, never while deriving. */
  readonly initialSelectionMode: NativePickerSelectionMode | null;
}

/** Fixed built-in presentation only; no stores, eligibility rules or action effects. */
export function deriveNativePickerPresentation({
  models,
  presetModels,
  current,
  savedSelectionMode,
}: NativePickerPresentationInput): NativePickerPresentation {
  const presets = deriveNativeBuiltinPresets(presetModels);
  const advertisedChoices = nativeAdvertisedModelChoices(presetModels);
  const preferredModel = models.find((model) => model.isDefault);
  const preferredId = preferredModel === undefined
    ? undefined
    : `${preferredModel.model}:${preferredModel.defaultReasoningEffort}`;
  const defaultChoice = nativeDefaultModelChoice(presets, preferredId);
  const selectedPreset = presets.find((choice) =>
    choice.model === current.model &&
    choice.reasoningEffort === current.displayReasoningEffort);
  const effectiveSelectionMode = selectedPreset === undefined
    ? "model"
    : savedSelectionMode ?? "default";
  return {
    presets,
    advertisedChoices,
    preferredModel,
    defaultChoice,
    selectedPreset,
    effectiveSelectionMode,
    initialSelectionMode: savedSelectionMode === null ? effectiveSelectionMode : null,
  };
}
