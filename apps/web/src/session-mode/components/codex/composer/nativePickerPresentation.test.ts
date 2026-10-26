import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deriveNativeBuiltinPresets,
  nativeDefaultModelChoice,
  type AlreadyEligiblePresetModel,
  type NativePowerChoice,
} from "./nativeBuiltinModelPresets";

type SelectionMode = "default" | "model";
type Metadata = { readonly model: string; readonly isDefault: boolean; readonly defaultReasoningEffort: string };
type Input = {
  models: readonly Metadata[];
  presetModels: readonly AlreadyEligiblePresetModel[];
  current: { readonly model: string; readonly displayReasoningEffort: string };
  savedSelectionMode: SelectionMode | null;
};
type Presentation = {
  presets: readonly NativePowerChoice[];
  advertisedChoices: readonly NativePowerChoice[];
  preferredModel: Metadata | undefined;
  defaultChoice: NativePowerChoice | undefined;
  selectedPreset: NativePowerChoice | undefined;
  effectiveSelectionMode: SelectionMode;
  initialSelectionMode: SelectionMode | null;
};
type Derive = (input: Input) => Presentation;
const SUBJECT_MODULES = import.meta.glob("./nativePickerPresentation.ts");
const forbiddenFetch = vi.fn(() => { throw Error("E4_PRESENTATION_UNEXPECTED_HTTP"); });
async function actualDerive(): Promise<Derive> {
  expect(typeof SUBJECT_MODULES["./nativePickerPresentation.ts"],
    "new pure presentation module must exist (availability only)").toBe("function");
  const module = await vi.importActual<Record<string, unknown>>("./nativePickerPresentation");
  expect(typeof module.deriveNativePickerPresentation,
    "deriveNativePickerPresentation must exist (availability only)").toBe("function");
  // Subsequent resolver/TypeError/assertion failures are not reclassified as availability RED.
  return module.deriveNativePickerPresentation as Derive;
}
function freezeData(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
}
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol";
function eligible(model: string, efforts: readonly string[], displayName = model): AlreadyEligiblePresetModel {
  // Explicit presentation-fixture input only; this is not an eligibility read or decision.
  return { model, displayName, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "fixture advertised effort" })) };
}
function metadata(model: string, isDefault: boolean, defaultReasoningEffort: string): Metadata {
  return { model, isDefault, defaultReasoningEffort };
}
function choice(model: string, effort: string, label: string, index: number): NativePowerChoice {
  // Literal fixture shaping only; no call to the subject/C derivation to produce expected data.
  return { id: model + ":" + effort, model, modelLabel: label, reasoningEffort: effort, powerSettingIndex: index };
}
const FOUR = [
  choice(TERRA, "low", "5.6 Terra", 0), choice(SOL, "low", "5.6 Sol", 1),
  choice(SOL, "medium", "5.6 Sol", 2), choice(SOL, "high", "5.6 Sol", 3),
];
const THREE_PRIMARY = FOUR.slice(0, 3);
const SECONDARY = [choice(TERRA, "low", "5.6 Terra", 0), choice(TERRA, "medium", "5.6 Terra", 1), choice(TERRA, "high", "5.6 Terra", 2)];
const baseModels = () => [metadata(TERRA, true, "low"), metadata(SOL, false, "medium")];
const basePresetModels = () => [eligible(TERRA, ["low"]), eligible(SOL, ["low", "medium", "high"])];
function input(overrides: Partial<Input> = {}): Input {
  return { models: baseModels(), presetModels: basePresetModels(), current: { model: SOL, displayReasoningEffort: "medium" }, savedSelectionMode: null, ...overrides };
}
type Fixture = {
  name: string; input: Input;
  expected: { presets: readonly NativePowerChoice[]; advertised: readonly NativePowerChoice[];
    preferredIndex: number | null; defaultIndex: number | null; selectedIndex: number | null;
    effective: SelectionMode; initial: SelectionMode | null };
};
const CASES: Fixture[] = [
  { name: "null in Et derives default and exact selected/default references", input: input(),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: 0, defaultIndex: 0, selectedIndex: 2, effective: "default", initial: "default" } },
  { name: "saved model in Et stays model with no initial-write suggestion", input: input({ savedSelectionMode: "model" }),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: 0, defaultIndex: 0, selectedIndex: 2, effective: "model", initial: null } },
  { name: "saved default outside Et derives model without overwriting saved default", input: input({
      presetModels: [eligible(TERRA, ["low", "high"]), eligible(SOL, ["low", "medium", "high"])],
      current: { model: TERRA, displayReasoningEffort: "high" }, savedSelectionMode: "default" }),
    expected: { presets: FOUR, advertised: [choice(TERRA, "low", "5.6 Terra", 0), choice(TERRA, "high", "5.6 Terra", 1),
      choice(SOL, "low", "5.6 Sol", 2), choice(SOL, "medium", "5.6 Sol", 3), choice(SOL, "high", "5.6 Sol", 4)],
      preferredIndex: 0, defaultIndex: 0, selectedIndex: null, effective: "model", initial: null } },
  { name: "null outside Et suggests model even with an advertised non-preset pair", input: input({
      presetModels: [eligible(TERRA, ["low", "high"]), eligible(SOL, ["low", "medium", "high"])],
      current: { model: TERRA, displayReasoningEffort: "high" } }),
    expected: { presets: FOUR, advertised: [choice(TERRA, "low", "5.6 Terra", 0), choice(TERRA, "high", "5.6 Terra", 1),
      choice(SOL, "low", "5.6 Sol", 2), choice(SOL, "medium", "5.6 Sol", 3), choice(SOL, "high", "5.6 Sol", 4)],
      preferredIndex: 0, defaultIndex: 0, selectedIndex: null, effective: "model", initial: "model" } },
  { name: "incoming bt medium is not replaced by current Terra-low TX fallback", input: input({ current: { model: TERRA, displayReasoningEffort: "medium" } }),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: 0, defaultIndex: 0, selectedIndex: null, effective: "model", initial: "model" } },
  { name: "preferredModel is first isDefault in ke even when absent from presetModels", input: input({ models: [
      metadata("outside-canonical", true, "high"), metadata(TERRA, true, "low"), metadata(SOL, true, "medium") ] }),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: 0, defaultIndex: 3, selectedIndex: 2, effective: "default", initial: "default" } },
  { name: "no isDefault leaves preferred undefined and TX selects Sol medium", input: input({ models: [metadata(TERRA, false, "low"), metadata(SOL, false, "high")] }),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: null, defaultIndex: 2, selectedIndex: 2, effective: "default", initial: "default" } },
  { name: "three primary choices beat four secondary and do not select Terra medium", input: input({
      presetModels: [eligible(TERRA, ["low", "medium", "high", "xhigh"]), eligible(SOL, ["low", "medium"])],
      current: { model: TERRA, displayReasoningEffort: "medium" } }),
    expected: { presets: THREE_PRIMARY, advertised: [choice(TERRA, "low", "5.6 Terra", 0), choice(TERRA, "medium", "5.6 Terra", 1),
      choice(TERRA, "high", "5.6 Terra", 2), choice(TERRA, "xhigh", "5.6 Terra", 3), choice(SOL, "low", "5.6 Sol", 4), choice(SOL, "medium", "5.6 Sol", 5)],
      preferredIndex: 0, defaultIndex: 0, selectedIndex: null, effective: "model", initial: "model" } },
  { name: "secondary threshold uses declaration order while advertised choices preserve input order", input: input({
      models: [metadata(TERRA, true, "high")], presetModels: [eligible(TERRA, ["high", "low", "medium"])],
      current: { model: TERRA, displayReasoningEffort: "high" } }),
    expected: { presets: SECONDARY, advertised: [choice(TERRA, "high", "5.6 Terra", 0), choice(TERRA, "low", "5.6 Terra", 1), choice(TERRA, "medium", "5.6 Terra", 2)],
      preferredIndex: 0, defaultIndex: 2, selectedIndex: 2, effective: "default", initial: "default" } },
  { name: "two advertised primary pairs expose no preset or default choice", input: input({
      presetModels: [eligible(TERRA, ["low"]), eligible(SOL, ["low"])], current: { model: TERRA, displayReasoningEffort: "low" } }),
    expected: { presets: [], advertised: FOUR.slice(0, 2), preferredIndex: 0, defaultIndex: null, selectedIndex: null, effective: "model", initial: "model" } },
  { name: "qualifying primary retains declaration-index holes", input: input({ presetModels: [eligible(TERRA, ["low"]), eligible(SOL, ["medium", "high"])] }),
    expected: { presets: [FOUR[0], FOUR[2], FOUR[3]], advertised: [choice(TERRA, "low", "5.6 Terra", 0), choice(SOL, "medium", "5.6 Sol", 1), choice(SOL, "high", "5.6 Sol", 2)],
      preferredIndex: 0, defaultIndex: 0, selectedIndex: 1, effective: "default", initial: "default" } },
  { name: "empty ke and vt return absent objects and model suggestion without manufacturing choices", input: input({
      models: [], presetModels: [], current: { model: "unknown-current", displayReasoningEffort: "medium" } }),
    expected: { presets: [], advertised: [], preferredIndex: null, defaultIndex: null, selectedIndex: null, effective: "model", initial: "model" } },
  { name: "saved default in Et stays default and first of multiple defaults wins", input: input({
      models: [metadata(TERRA, true, "low"), metadata(SOL, true, "high")], savedSelectionMode: "default" }),
    expected: { presets: FOUR, advertised: FOUR, preferredIndex: 0, defaultIndex: 0, selectedIndex: 2, effective: "default", initial: null } },
  { name: "duplicate advertisements keep order and first qualifying labels while choices reference this Et", input: input({
      models: [metadata(SOL, true, "medium"), metadata(TERRA, false, "low")], savedSelectionMode: "model",
      presetModels: [eligible(TERRA, ["low"]), eligible(SOL, ["medium", "low", "medium"], "Sol First"), eligible(SOL, ["high"], "Sol Later")] }),
    expected: { presets: [choice(TERRA, "low", "5.6 Terra", 0), choice(SOL, "low", "Sol First", 1), choice(SOL, "medium", "Sol First", 2), choice(SOL, "high", "Sol Later", 3)],
      advertised: [choice(TERRA, "low", "5.6 Terra", 0), choice(SOL, "medium", "Sol First", 1), choice(SOL, "low", "Sol First", 2), choice(SOL, "medium", "Sol First", 3), choice(SOL, "high", "Sol Later", 4)],
      preferredIndex: 0, defaultIndex: 2, selectedIndex: 2, effective: "model", initial: null } },
];

beforeEach(() => {
  forbiddenFetch.mockClear(); vi.stubGlobal("fetch", forbiddenFetch);
  vi.spyOn(Storage.prototype, "getItem"); vi.spyOn(Storage.prototype, "setItem"); vi.spyOn(Storage.prototype, "removeItem");
});
afterEach(() => {
  try {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(Storage.prototype.getItem).not.toHaveBeenCalled(); expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.removeItem).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it.each(CASES)("pure presentation: $name", async (fixture) => {
  const derive = await actualDerive();
  const data = structuredClone(fixture.input), before = structuredClone(data);
  const modelRefs = [...data.models], presetRefs = [...data.presetModels];
  const effortRefs = data.presetModels.map((record) => record.supportedReasoningEfforts);
  const optionRefs = data.presetModels.map((record) => [...record.supportedReasoningEfforts]);
  freezeData(data);
  const actual = derive(data), wanted = fixture.expected;
  expect(actual.presets).toEqual(wanted.presets); expect(actual.advertisedChoices).toEqual(wanted.advertised);
  expect(actual.preferredModel).toBe(wanted.preferredIndex === null ? undefined : data.models[wanted.preferredIndex]);
  expect(actual.defaultChoice).toBe(wanted.defaultIndex === null ? undefined : actual.presets[wanted.defaultIndex]);
  expect(actual.selectedPreset).toBe(wanted.selectedIndex === null ? undefined : actual.presets[wanted.selectedIndex]);
  expect(actual.effectiveSelectionMode).toBe(wanted.effective); expect(actual.initialSelectionMode).toBe(wanted.initial);
  expect(data).toEqual(before);
  data.models.forEach((record, index) => expect(record).toBe(modelRefs[index]));
  data.presetModels.forEach((record, index) => {
    expect(record).toBe(presetRefs[index]); expect(record.supportedReasoningEfforts).toBe(effortRefs[index]);
    record.supportedReasoningEfforts.forEach((option, slot) => expect(option).toBe(optionRefs[index][slot]));
  });
  const repeat = derive(data);
  expect(repeat).toEqual(actual);
  expect(repeat.defaultChoice).toBe(wanted.defaultIndex === null ? undefined : repeat.presets[wanted.defaultIndex]);
  expect(repeat.selectedPreset).toBe(wanted.selectedIndex === null ? undefined : repeat.presets[wanted.selectedIndex]);
  expect(data).toEqual(before);
});

it("existing C control derives the four literal primary choices without the new module", () => {
  const models = basePresetModels(), before = structuredClone(models); freezeData(models);
  expect(deriveNativeBuiltinPresets(models)).toEqual(FOUR); expect(models).toEqual(before);
});
it("existing C control keeps TX preferred-suffix fallback and original choice identity", () => {
  const choices = structuredClone(FOUR); freezeData(choices);
  expect(nativeDefaultModelChoice(choices, "outside-canonical:high")).toBe(choices[3]);
  expect(nativeDefaultModelChoice(choices, "gpt-5.6-terra:low")).toBe(choices[0]);
  expect(choices).toEqual(FOUR);
});
