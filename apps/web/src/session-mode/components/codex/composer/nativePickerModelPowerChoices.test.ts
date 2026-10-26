import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deriveNativeBuiltinPresets, nativeAdvertisedModelChoices, type AlreadyEligiblePresetModel, type NativePowerChoice } from "./nativeBuiltinModelPresets";

type Derive = (models: readonly AlreadyEligiblePresetModel[], currentModel: string) => NativePowerChoice[];
const MODULES = import.meta.glob("./nativePickerModelPowerChoices.ts");
const available = typeof MODULES["./nativePickerModelPowerChoices.ts"] === "function";
const behavior = available ? it : it.skip;
const TERRA = "gpt-5.6-terra", SOL = "gpt-5.6-sol";
function record(model: string, efforts: readonly string[], displayName = model): AlreadyEligiblePresetModel {
  return { model, displayName, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "literal fixture" })) };
}
function choice(model: string, reasoningEffort: string, modelLabel: string, powerSettingIndex: number): NativePowerChoice {
  return { id: model + ":" + reasoningEffort, model, reasoningEffort, modelLabel, powerSettingIndex };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
async function actual(): Promise<Derive> {
  expect(available, "new pure model physical helper availability only").toBe(true);
  const module = await vi.importActual<Record<string, unknown>>("./nativePickerModelPowerChoices");
  expect(typeof module.nativePickerModelPowerChoices, "new pure helper export availability only").toBe("function");
  return module.nativePickerModelPowerChoices as Derive;
}
const CASES = [
  { name: "keeps only the canonical current model and reindexes after slicing", models: [record(TERRA, ["low"]), record(SOL, ["high", "low", "medium"])], current: SOL,
    expected: [choice(SOL, "high", "5.6 Sol", 0), choice(SOL, "low", "5.6 Sol", 1), choice(SOL, "medium", "5.6 Sol", 2)] },
  { name: "keeps duplicate effort entries and repeated current records in order", models: [record(SOL, ["medium", "low", "medium"], "First Sol"), record(TERRA, ["low"]), record(SOL, ["high"], "Later Sol")], current: SOL,
    expected: [choice(SOL, "medium", "First Sol", 0), choice(SOL, "low", "First Sol", 1), choice(SOL, "medium", "First Sol", 2), choice(SOL, "high", "Later Sol", 3)] },
  { name: "known empty retains an unadvertised medium placeholder", models: [record(SOL, [])], current: SOL,
    expected: [choice(SOL, "medium", "5.6 Sol", 0)] },
  { name: "persistent-only and unrecognized-only each retain their own placeholder", models: [record(SOL, ["persistent"], "Persistent Sol"), record(SOL, ["future-effort"], "Future Sol")], current: SOL,
    expected: [choice(SOL, "medium", "Persistent Sol", 0), choice(SOL, "medium", "Future Sol", 1)] },
  { name: "does not recheck a placeholder against another repeated record advertisement", models: [record(SOL, [], "Empty First"), record(SOL, ["medium"], "Advertised Later")], current: SOL,
    expected: [choice(SOL, "medium", "Empty First", 0), choice(SOL, "medium", "Advertised Later", 1)] },
  { name: "recognizes wire efforts independently of the caller UI policy", models: [record(SOL, ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent", "future-effort"])], current: SOL,
    expected: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((effort, index) => choice(SOL, effort, "5.6 Sol", index)) },
  { name: "missing current canonical model does not fabricate unknown six", models: [record(SOL, ["low", "medium", "high"])], current: "fixture-unknown",
    expected: [] },
  { name: "empty catalog stays empty", models: [], current: SOL, expected: [] },
];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Unexpected pure E7 HTTP"); }));
  vi.spyOn(Storage.prototype, "getItem"); vi.spyOn(Storage.prototype, "setItem"); vi.spyOn(Storage.prototype, "removeItem");
});
afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(Storage.prototype.getItem).not.toHaveBeenCalled(); expect(Storage.prototype.setItem).not.toHaveBeenCalled(); expect(Storage.prototype.removeItem).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
it("exposes the new pure helper without a missing-module loader failure", async () => { await actual(); });
behavior.each(CASES)("physical model domain: $name", async ({ models, current, expected }) => {
  const derive = await actual(), data = structuredClone(models), before = structuredClone(data);
  const refs = data.map((entry) => ({ entry, efforts: entry.supportedReasoningEfforts, options: [...entry.supportedReasoningEfforts] }));
  freeze(data);
  expect(derive(data, current)).toEqual(expected); expect(derive(data, current)).toEqual(expected); expect(data).toEqual(before);
  data.forEach((entry, index) => {
    expect(entry).toBe(refs[index].entry); expect(entry.supportedReasoningEfforts).toBe(refs[index].efforts);
    entry.supportedReasoningEfforts.forEach((option, slot) => expect(option).toBe(refs[index].options[slot]));
  });
});
it("existing C keeps Et advertisement thresholds and declaration-index holes", () => {
  const data = [record(TERRA, ["low"]), record(SOL, ["medium", "xhigh"])], before = structuredClone(data); freeze(data);
  expect(deriveNativeBuiltinPresets(data)).toEqual([choice(TERRA, "low", "5.6 Terra", 0), choice(SOL, "medium", "5.6 Sol", 2), choice(SOL, "xhigh", "5.6 Sol", 4)]);
  expect(data).toEqual(before);
});
it("existing C advertised domain remains separate from the new unadvertised placeholder", () => {
  const data = [record(SOL, [])]; freeze(data);
  expect(nativeAdvertisedModelChoices(data)).toEqual([]); expect(deriveNativeBuiltinPresets(data)).toEqual([]);
});
