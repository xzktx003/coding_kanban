import { expect, it } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import { nativeMenuReasoningEffort } from "./nativeReasoningOptions";

type MenuModel = Parameters<typeof nativeMenuReasoningEffort>[1];

function model(
  name: string,
  efforts: ReasoningEffort[],
  defaultReasoningEffort: ReasoningEffort,
  isDefault = true,
): MenuModel {
  return {
    model: name,
    isDefault,
    defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
  };
}

// Seven declared inputs independently calculated from sealed original
// Z6r/mJr/TX helpers. No original module, component, or setter is executed here.
it.each([
  { name: "single-low", efforts: ["low"], currentDefault: "low", expected: "low" },
  { name: "single-none", efforts: ["none"], currentDefault: "none", expected: "none" },
  { name: "single-ultra", efforts: ["ultra"], currentDefault: "ultra", expected: "ultra" },
  { name: "two-default-low", efforts: ["low", "high"], currentDefault: "low", expected: "low" },
  { name: "two-default-high", efforts: ["low", "high"], currentDefault: "high", expected: "high" },
  { name: "two-selected-not-default", efforts: ["low", "high"], currentDefault: "high", otherDefault: "medium", expected: "low" },
  { name: "two-sol-default-other-high", efforts: ["low", "high"], currentDefault: "low", otherDefault: "high", sol: true, expected: "high" },
] as const)("matches the original current-model TX result: $name", ({ efforts, currentDefault, expected, ...fixture }) => {
  const otherDefault = "otherDefault" in fixture ? fixture.otherDefault : undefined;
  const hasOtherDefault = otherDefault !== undefined;
  const selected = model(
    "sol" in fixture ? "gpt-5.6-sol" : "fixture-known",
    [...efforts],
    currentDefault,
    !hasOtherDefault,
  );
  const catalog = otherDefault !== undefined
    ? [model("fixture-other", [otherDefault], otherDefault), selected]
    : [selected];
  const before = structuredClone(catalog);
  const advertised = selected.supportedReasoningEfforts;
  expect(nativeMenuReasoningEffort(null, selected, catalog)).toBe(expected);
  expect(catalog).toEqual(before);
  expect(selected.supportedReasoningEfforts).toBe(advertised);
});
