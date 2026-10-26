import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";
import {
  NATIVE_UNKNOWN_REASONING_OPTIONS,
  nativeReasoningCommand,
  nativeReasoningOptions,
} from "./nativeReasoningOptions";

type Project = (
  alreadyEligibleModels: readonly Model[],
  enabledReasoningEfforts: readonly ReasoningEffort[],
  includeUltra: boolean,
) => Model[];
const SUBJECT_MODULES = import.meta.glob("./nativePickerEffortProjection.ts");
const forbiddenFetch = vi.fn(() => { throw Error("R28E2_UNEXPECTED_HTTP"); });
async function actualProject(): Promise<Project> {
  expect(typeof SUBJECT_MODULES["./nativePickerEffortProjection.ts"],
    "new picker effort projection module must exist (availability only)").toBe("function");
  const module = await vi.importActual<Record<string, unknown>>("./nativePickerEffortProjection");
  expect(typeof module.projectNativePickerEfforts,
    "projectNativePickerEfforts must be available (availability only)").toBe("function");
  return module.projectNativePickerEfforts as Project;
}
function model(name: string, efforts: readonly ReasoningEffort[], overrides: Partial<Model> = {}): Model {
  return { id: `wire-${name}`, model: name, displayName: `Raw ${name}`, description: "fixture catalog record",
    upgrade: null, upgradeInfo: null, availabilityNux: null, hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort, index) => ({ reasoningEffort, description: `slot-${index}-${reasoningEffort}` })),
    defaultReasoningEffort: efforts[0] ?? "medium", isDefault: false,
    inputModalities: ["text"], supportsPersonality: false, additionalSpeedTiers: [],
    serviceTiers: [], defaultServiceTier: null, ...overrides };
}
function freezeData(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
}
function capture(models: readonly Model[], prefs: readonly ReasoningEffort[]) {
  return { values: structuredClone(models), prefs: [...prefs], records: [...models],
    lists: models.map(item => item.supportedReasoningEfforts),
    options: models.map(item => [...item.supportedReasoningEfforts]) };
}
function expectUnchanged(models: readonly Model[], prefs: readonly ReasoningEffort[], before: ReturnType<typeof capture>) {
  expect(models).toEqual(before.values); expect(prefs).toEqual(before.prefs);
  models.forEach((item, index) => {
    expect(item).toBe(before.records[index]);
    expect(item.supportedReasoningEfforts).toBe(before.lists[index]);
    item.supportedReasoningEfforts.forEach((option, optionIndex) => expect(option).toBe(before.options[index][optionIndex]));
  });
}
function expectProjection(actual: Model[], raw: readonly Model[], indices: readonly (readonly number[])[]) {
  expect(actual).not.toBe(raw); expect(actual).toHaveLength(raw.length);
  actual.forEach((item, index) => {
    const original = raw[index];
    expect(item).not.toBe(original);
    expect(item.supportedReasoningEfforts).not.toBe(original.supportedReasoningEfforts);
    expect(item.supportedReasoningEfforts).toEqual(indices[index].map(slot => original.supportedReasoningEfforts[slot]));
    for (const key of Object.keys(original)) {
      if (key !== "supportedReasoningEfforts") expect(Reflect.get(item, key)).toBe(Reflect.get(original, key));
    }
  });
}
beforeEach(() => {
  forbiddenFetch.mockClear(); vi.stubGlobal("fetch", forbiddenFetch);
  vi.spyOn(Storage.prototype, "getItem"); vi.spyOn(Storage.prototype, "setItem"); vi.spyOn(Storage.prototype, "removeItem");
});
afterEach(() => {
  try {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.removeItem).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

// These are explicit inputs, not an import of an application preference store.
const NINE: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const H_AT: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "ultra", "persistent"];
const CASES: { name: string; advertised: ReasoningEffort[]; enabled: ReasoningEffort[]; includeUltra: boolean;
  indices: number[]; expected: ReasoningEffort[]; picker: ReasoningEffort[] }[] = [
  { name: "explicit hAt membership with ultra off", advertised: NINE, enabled: H_AT, includeUltra: false,
    indices: [2, 3, 4, 5, 8], expected: ["low", "medium", "high", "xhigh", "persistent"], picker: ["low", "medium", "high", "xhigh"] },
  { name: "explicit hAt membership with ultra on", advertised: NINE, enabled: H_AT, includeUltra: true,
    indices: [2, 3, 4, 5, 7, 8], expected: ["low", "medium", "high", "xhigh", "ultra", "persistent"], picker: ["low", "medium", "high", "xhigh", "ultra"] },
  { name: "empty preference still retains advertised persistent duplicates", advertised: ["medium", "persistent", "low", "persistent"], enabled: [], includeUltra: false,
    indices: [1, 3], expected: ["persistent", "persistent"], picker: [] },
  { name: "preference is membership and never orders or deduplicates advertisements", advertised: ["high", "low", "high", "medium", "persistent"], enabled: ["high", "low", "high"], includeUltra: false,
    indices: [0, 1, 2, 4], expected: ["high", "low", "high", "persistent"], picker: ["high", "low", "high"] },
  { name: "known record filtered to empty stays known with zero choices", advertised: ["medium"], enabled: [], includeUltra: true,
    indices: [], expected: [], picker: [] },
  { name: "already empty advertisements stay empty without synthesized medium", advertised: [], enabled: ["medium"], includeUltra: true,
    indices: [], expected: [], picker: [] },
  { name: "ultra on alone cannot bypass absent enabled membership", advertised: ["ultra", "low", "persistent"], enabled: ["low"], includeUltra: true,
    indices: [1, 2], expected: ["low", "persistent"], picker: ["low"] },
  { name: "explicit nine-value opt in preserves all nine advertisements", advertised: NINE, enabled: NINE, includeUltra: true,
    indices: [0, 1, 2, 3, 4, 5, 6, 7, 8], expected: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"], picker: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
  { name: "original yC rejects future advertisements even with explicit future membership", advertised: ["future-effort", "low", "persistent", "Future-Effort"], enabled: ["future-effort", "Future-Effort", "low"], includeUltra: true,
    indices: [1, 2], expected: ["low", "persistent"], picker: ["low"] },
];
it.each(CASES)("projects the explicit ordinary advertisement membership: $name", async fixture => {
  const project = await actualProject(), raw = [model("fixture-current", fixture.advertised)], prefs = [...fixture.enabled];
  const before = capture(raw, prefs); freezeData(raw); freezeData(prefs);
  const result = project(raw, prefs, fixture.includeUltra);
  expectProjection(result, raw, [fixture.indices]);
  expect(result[0].supportedReasoningEfforts.map(option => option.reasoningEffort)).toEqual(fixture.expected);
  expect(nativeReasoningOptions(result[0])).toEqual(fixture.picker);
  expectUnchanged(raw, prefs, before);
});

it("keeps every eligible record, duplicate canonical identity, hidden/isDefault and all other property references", async () => {
  const project = await actualProject();
  const first = Object.assign(model("same-canonical", ["high", "ultra"], { id: "alias-first", hidden: true,
    isDefault: true, defaultReasoningEffort: "ultra", upgrade: "keep-upgrade", description: "first raw description",
    inputModalities: ["text", "image"], supportsPersonality: true, additionalSpeedTiers: ["priority"], defaultServiceTier: "priority" }),
    { futureCatalogMetadata: { mustKeepReference: true } });
  const second = model("same-canonical", ["medium"], { id: "alias-second", displayName: "Other raw label" });
  const third = model("third-canonical", ["persistent"], { id: "alias-third" });
  const raw = [first, second, third], prefs: ReasoningEffort[] = ["high"], before = capture(raw, prefs);
  freezeData(raw); freezeData(prefs);
  const result = project(raw, prefs, false);
  expectProjection(result, raw, [[0], [], [0]]);
  expect(result.map(item => [item.id, item.model, item.isDefault, item.defaultReasoningEffort])).toEqual([
    ["alias-first", "same-canonical", true, "ultra"],
    ["alias-second", "same-canonical", false, "medium"],
    ["alias-third", "third-canonical", false, "persistent"],
  ]);
  expectUnchanged(raw, prefs, before);
});

it("returns a new empty catalog and never invents a record for an unknown canonical model", async () => {
  const project = await actualProject(), raw: Model[] = [], prefs: ReasoningEffort[] = ["low", "medium", "high"];
  const before = capture(raw, prefs); freezeData(raw); freezeData(prefs);
  const result = project(raw, prefs, true);
  expect(result).toEqual([]); expect(result).not.toBe(raw);
  expectUnchanged(raw, prefs, before);
});

it("allocates fresh records and effort lists on each call without reusing caller-mutated outputs", async () => {
  const project = await actualProject(), raw = [model("fixture-current", ["low", "high", "persistent"])];
  const prefs: ReasoningEffort[] = ["low"], before = capture(raw, prefs); freezeData(raw); freezeData(prefs);
  const first = project(raw, prefs, false); expectProjection(first, raw, [[0, 2]]);
  first[0].displayName = "caller-only output mutation"; first[0].supportedReasoningEfforts.pop(); first.pop();
  const second = project(raw, prefs, false);
  expectProjection(second, raw, [[0, 2]]); expect(second).not.toBe(first);
  expectUnchanged(raw, prefs, before);
});

it("does not freeze caller arrays or let later raw/pref array mutation rewrite an already projected effort list", async () => {
  const project = await actualProject(), raw = [model("fixture-current", ["low"])], prefs: ReasoningEffort[] = ["low"];
  const before = capture(raw, prefs), result = project(raw, prefs, false);
  expectProjection(result, raw, [[0]]); expectUnchanged(raw, prefs, before);
  expect(Object.isFrozen(raw)).toBe(false); expect(Object.isFrozen(raw[0])).toBe(false);
  expect(Object.isFrozen(raw[0].supportedReasoningEfforts)).toBe(false); expect(Object.isFrozen(prefs)).toBe(false);
  raw[0].supportedReasoningEfforts.push({ reasoningEffort: "high", description: "caller added raw option" }); prefs.push("high");
  expect(result[0].supportedReasoningEfforts.map(option => option.reasoningEffort)).toEqual(["low"]);
  expect(project(raw, prefs, false)[0].supportedReasoningEfforts.map(option => option.reasoningEffort)).toEqual(["low", "high"]);
});

it("control: existing nativeReasoningOptions keeps its eight recognized picker efforts without app preference filtering", () => {
  const raw = model("existing-control", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent", "future-effort"]);
  const before = structuredClone(raw); freezeData(raw);
  expect(nativeReasoningOptions(raw)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  expect(raw).toEqual(before);
});

it("control: existing unknown canonical fallback stays the independent frozen Pzt six", () => {
  expect(NATIVE_UNKNOWN_REASONING_OPTIONS).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  expect(Object.isFrozen(NATIVE_UNKNOWN_REASONING_OPTIONS)).toBe(true);
  const knownEmpty = model("known-empty-control", []), before = structuredClone(knownEmpty); freezeData(knownEmpty);
  expect(nativeReasoningOptions(knownEmpty)).toEqual([]); expect(knownEmpty).toEqual(before);
});

it("control: existing explicit singleton current-model command remains independent of preferences", () => {
  const options: ReasoningEffort[] = ["low"], before = [...options]; freezeData(options);
  expect(nativeReasoningCommand(options, null, 1, false)).toBe("low");
  expect(nativeReasoningCommand(options, null, -1, false)).toBe("low");
  expect(nativeReasoningCommand(options, null, 1, true)).toBe("low");
  expect(options).toEqual(before);
});
