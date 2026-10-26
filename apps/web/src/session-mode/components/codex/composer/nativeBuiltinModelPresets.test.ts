import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Model } from "@session/bindings/v2";
import { canonicalNativeItems, canonicalNativeModel } from "./nativeModelIdentity";
import { nativeMenuReasoningEffort, nativeReasoningOptions } from "./nativeReasoningOptions";

type EligiblePresetModel = {
  readonly model: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly { readonly reasoningEffort: string; readonly description: string }[];
};
type PowerChoice = {
  id: string; model: string; modelLabel: string; reasoningEffort: string; powerSettingIndex: number;
};
type DefaultChoice = Pick<PowerChoice, "id" | "model" | "reasoningEffort">;
type PureAPI = {
  deriveNativeBuiltinPresets(alreadyEligibleModels: readonly EligiblePresetModel[]): PowerChoice[];
  nativeAdvertisedModelChoices(alreadyEligibleModels: readonly EligiblePresetModel[]): PowerChoice[];
  nativeDefaultModelChoice<T extends DefaultChoice>(choices: readonly T[], preferredId?: string): T | undefined;
};
const SUBJECT_MODULES = import.meta.glob("./nativeBuiltinModelPresets.ts");
const forbiddenFetch = vi.fn(() => { throw Error("R28C_UNEXPECTED_NETWORK"); });
async function actualPureAPI(): Promise<PureAPI> {
  // No static import of a nonexistent module. Preserve a classified interface-availability RED.
  expect(typeof SUBJECT_MODULES["./nativeBuiltinModelPresets.ts"], "new pure builtin module must exist (availability only)").toBe("function");
  const module = await vi.importActual<Record<string, unknown>>("./nativeBuiltinModelPresets");
  for (const name of ["deriveNativeBuiltinPresets", "nativeAdvertisedModelChoices", "nativeDefaultModelChoice"]) {
    expect(typeof module[name], `${name} must be available (availability only)`).toBe("function");
  }
  // After existence, resolver/loader/TypeError exceptions are NOT reclassified as behavior RED.
  return module as unknown as PureAPI;
}
function freezeInput(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeInput(child);
    Object.freeze(value);
  }
}
function eligible(model: string, efforts: readonly string[], displayName = model): EligiblePresetModel {
  // Fixture schema builder only; eligibility is an explicit assumption, never inferred here.
  return { model, displayName, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: "synthetic already eligible" })) };
}
function fullModel(model: string, efforts: string[], id = model): Model {
  return { id, model, displayName: model, description: "own control", hidden: false,
    supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: efforts[0] ?? "medium", isDefault: false, upgrade: null, upgradeInfo: null,
    availabilityNux: null, inputModalities: ["text"], supportsPersonality: false, additionalSpeedTiers: [],
    serviceTiers: [], defaultServiceTier: null };
}
beforeEach(() => { forbiddenFetch.mockClear(); vi.stubGlobal("fetch", forbiddenFetch); });
afterEach(() => {
  try { expect(forbiddenFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

const DERIVATION_CASES = [
  {"name":"four-pair-primary","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"}]},{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}]},
  {"name":"two-pairs-below-threshold","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"}]},{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"normalized synthetic only"}]}],"expected":[]},
  {"name":"primary-three-beats-secondary-four","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"xhigh","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"low","description":"normalized synthetic only"}]},{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2}]},
  {"name":"secondary-declaration-holes","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"},{"reasoningEffort":"xhigh","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:medium","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"medium","powerSettingIndex":1},{"id":"gpt-5.6-terra:high","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"high","powerSettingIndex":2},{"id":"gpt-5.6-terra:xhigh","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"xhigh","powerSettingIndex":3}]},
  {"name":"persistent-retained-input-but-not-ui-choice","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"},{"reasoningEffort":"persistent","description":"normalized synthetic only"}]},{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"persistent","description":"normalized synthetic only"},{"reasoningEffort":"low","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}]},
  {"name":"unadvertised-medium-placeholder-cannot-count","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"persistent","description":"normalized synthetic only"}]},{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"}]}],"expected":[],"expectedAdvertised":[{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":2}]},
  {"name":"all-fixed-primary-ordered-not-catalog-order","alreadyEligibleModels":[{"model":"gpt-5.6-sol","displayName":"gpt-5.6-sol","supportedReasoningEfforts":[{"reasoningEffort":"ultra","description":"normalized synthetic only"},{"reasoningEffort":"xhigh","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"low","description":"normalized synthetic only"}]},{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"xhigh","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"low","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3},{"id":"gpt-5.6-sol:xhigh","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"xhigh","powerSettingIndex":4},{"id":"gpt-5.6-sol:ultra","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"ultra","powerSettingIndex":5}]},
  {"name":"all-fixed-secondary-ordered-not-advertised-order","alreadyEligibleModels":[{"model":"gpt-5.6-terra","displayName":"gpt-5.6-terra","supportedReasoningEfforts":[{"reasoningEffort":"xhigh","description":"normalized synthetic only"},{"reasoningEffort":"high","description":"normalized synthetic only"},{"reasoningEffort":"medium","description":"normalized synthetic only"},{"reasoningEffort":"low","description":"normalized synthetic only"}]}],"expected":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-terra:medium","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"medium","powerSettingIndex":1},{"id":"gpt-5.6-terra:high","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"high","powerSettingIndex":2},{"id":"gpt-5.6-terra:xhigh","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"xhigh","powerSettingIndex":3}]},
];
it.each(DERIVATION_CASES)("fixed builtin preset: $name", async fixture => {
  const api = await actualPureAPI();
  const models = structuredClone(fixture.alreadyEligibleModels), before = structuredClone(models);
  freezeInput(models);
  const actual = api.deriveNativeBuiltinPresets(models);
  expect(actual).toEqual(fixture.expected);
  if ("expectedAdvertised" in fixture) {
    expect(api.nativeAdvertisedModelChoices(models)).toEqual(fixture.expectedAdvertised);
  }
  expect(models).toEqual(before);
  expect(api.deriveNativeBuiltinPresets(models)).toEqual(fixture.expected);
});

// Direct literal choice inputs keep TX checks independent of local derive success.
const DEFAULT_CASES = [
  {"name":"TX-exact-preferred","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}],"preferredId":"gpt-5.6-terra:low","expectedId":"gpt-5.6-terra:low"},
  {"name":"TX-Sol-same-effort","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}],"preferredId":"missing:high","expectedId":"gpt-5.6-sol:high"},
  {"name":"TX-Sol-medium","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:medium","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"medium","powerSettingIndex":2},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}],"preferredId":"missing:max","expectedId":"gpt-5.6-sol:medium"},
  {"name":"TX-any-Sol","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-sol:low","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"low","powerSettingIndex":1},{"id":"gpt-5.6-sol:high","model":"gpt-5.6-sol","modelLabel":"5.6 Sol","reasoningEffort":"high","powerSettingIndex":3}],"preferredId":"missing:max","expectedId":"gpt-5.6-sol:low"},
  {"name":"TX-any-medium-without-Sol","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-terra:medium","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"medium","powerSettingIndex":1},{"id":"gpt-5.6-terra:high","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"high","powerSettingIndex":2}],"preferredId":"missing:max","expectedId":"gpt-5.6-terra:medium"},
  {"name":"TX-first-without-Sol-or-medium","choices":[{"id":"gpt-5.6-terra:low","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"low","powerSettingIndex":0},{"id":"gpt-5.6-terra:high","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"high","powerSettingIndex":2},{"id":"gpt-5.6-terra:xhigh","model":"gpt-5.6-terra","modelLabel":"5.6 Terra","reasoningEffort":"xhigh","powerSettingIndex":3}],"preferredId":"missing:none","expectedId":"gpt-5.6-terra:low"},
  {"name":"TX-empty-is-undefined","choices":[],"preferredId":"gpt-5.6-terra:low","expectedId":null},
];
it.each(DEFAULT_CASES)("TX Default fallback: $name", async fixture => {
  const api = await actualPureAPI();
  const choices = structuredClone(fixture.choices), before = structuredClone(choices);
  freezeInput(choices);
  const actual = api.nativeDefaultModelChoice(choices, fixture.preferredId);
  if (fixture.expectedId === null) expect(actual).toBeUndefined();
  else {
    expect(actual?.id).toBe(fixture.expectedId);
    expect(actual).toBe(choices.find(choice => choice.id === fixture.expectedId));
  }
  expect(choices).toEqual(before);
});

it("requires exact canonical model values, never a matching raw id or label alias", async () => {
  const api = await actualPureAPI();
  const models = [
    { ...eligible("alias-terra", ["low", "medium", "high"]), id: "gpt-5.6-terra", displayName: "gpt-5.6-terra" },
    { ...eligible("alias-sol", ["low", "medium", "high"]), id: "gpt-5.6-sol", displayName: "gpt-5.6-sol" },
  ];
  const before = structuredClone(models); freezeInput(models);
  expect(api.deriveNativeBuiltinPresets(models)).toEqual([]);
  expect(models).toEqual(before);
});

it("preserves duplicate advertised order and chooses the first qualifying canonical record label", async () => {
  const api = await actualPureAPI();
  const models = [eligible("gpt-5.6-terra", ["low"]),
    eligible("gpt-5.6-sol", ["medium", "low", "medium"], "First Medium Low"),
    eligible("gpt-5.6-sol", ["low", "high"], "Later Low High")];
  const before = structuredClone(models); freezeInput(models);
  expect(api.deriveNativeBuiltinPresets(models)).toEqual([
    { id: "gpt-5.6-terra:low", model: "gpt-5.6-terra", modelLabel: "5.6 Terra", reasoningEffort: "low", powerSettingIndex: 0 },
    { id: "gpt-5.6-sol:low", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "low", powerSettingIndex: 1 },
    { id: "gpt-5.6-sol:medium", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "medium", powerSettingIndex: 2 },
    { id: "gpt-5.6-sol:high", model: "gpt-5.6-sol", modelLabel: "Later Low High", reasoningEffort: "high", powerSettingIndex: 3 },
  ]);
  expect(api.nativeAdvertisedModelChoices(models)).toEqual([
    { id: "gpt-5.6-terra:low", model: "gpt-5.6-terra", modelLabel: "5.6 Terra", reasoningEffort: "low", powerSettingIndex: 0 },
    { id: "gpt-5.6-sol:medium", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "medium", powerSettingIndex: 1 },
    { id: "gpt-5.6-sol:low", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "low", powerSettingIndex: 2 },
    { id: "gpt-5.6-sol:medium", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "medium", powerSettingIndex: 3 },
    { id: "gpt-5.6-sol:low", model: "gpt-5.6-sol", modelLabel: "First Medium Low", reasoningEffort: "low", powerSettingIndex: 4 },
    { id: "gpt-5.6-sol:high", model: "gpt-5.6-sol", modelLabel: "Later Low High", reasoningEffort: "high", powerSettingIndex: 5 },
  ]);
  expect(models).toEqual(before);
});

it("filters persistent and unknown wire efforts without advertising a medium placeholder", async () => {
  const api = await actualPureAPI();
  const models = [eligible("gpt-5.6-terra", ["persistent", "future-effort"]),
    eligible("gpt-5.6-sol", ["persistent", "low", "medium", "high", "future-effort"])];
  const before = structuredClone(models); freezeInput(models);
  const expected = [
    { id: "gpt-5.6-sol:low", model: "gpt-5.6-sol", modelLabel: "5.6 Sol", reasoningEffort: "low", powerSettingIndex: 1 },
    { id: "gpt-5.6-sol:medium", model: "gpt-5.6-sol", modelLabel: "5.6 Sol", reasoningEffort: "medium", powerSettingIndex: 2 },
    { id: "gpt-5.6-sol:high", model: "gpt-5.6-sol", modelLabel: "5.6 Sol", reasoningEffort: "high", powerSettingIndex: 3 },
  ];
  expect(api.deriveNativeBuiltinPresets(models)).toEqual(expected);
  expect(api.nativeAdvertisedModelChoices(models)).toEqual(expected);
  expect(models).toEqual(before);
});

it("keeps later calls independent of mutations to an earlier returned builtin list", async () => {
  const api = await actualPureAPI();
  const fixture = DERIVATION_CASES[0], models = structuredClone(fixture.alreadyEligibleModels);
  const before = structuredClone(models); freezeInput(models);
  const first = api.deriveNativeBuiltinPresets(models);
  expect(first).toEqual(fixture.expected);
  first[0].modelLabel = "caller-only result mutation";
  first.pop();
  expect(api.deriveNativeBuiltinPresets(models)).toEqual(fixture.expected);
  expect(models).toEqual(before);
});

// These 3 current-helper controls never call/import the proposed new module.
it("keeps current canonical alias and raw label behavior as a separate existing-helper control", () => {
  const model = fullModel("gpt-5.6-sol", ["low", "high"], "wire-alias");
  const models = [model], before = structuredClone(models);
  expect(canonicalNativeModel(models, "wire-alias")).toBeUndefined();
  expect(canonicalNativeModel(models, "gpt-5.6-sol")).toBe(model);
  expect(canonicalNativeItems(models)[0]).toMatchObject({ id: "gpt-5.6-sol", label: "gpt-5.6-sol" });
  expect(models).toEqual(before);
});

it("keeps recognized order and duplicates in the existing reasoning-options helper", () => {
  const model = fullModel("control", ["persistent", "medium", "future-effort", "low", "medium"]);
  const before = structuredClone(model);
  expect(nativeReasoningOptions(model)).toEqual(["medium", "low", "medium"]);
  expect(model).toEqual(before);
});

it("retains the existing current-model TX helper without invoking the proposed preset API", () => {
  const current = fullModel("gpt-5.6-sol", ["low", "high"]);
  const other = { ...fullModel("other", ["high"]), isDefault: true };
  const models = [other, current], before = structuredClone(models);
  expect(nativeMenuReasoningEffort(null, current, models)).toBe("high");
  expect(models).toEqual(before);
});
