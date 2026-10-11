import { expect, it } from "vitest";
import { cycleServiceTier } from "./cycleServiceTier";

const tiers = [
  { id: "fast", name: "Fast", description: "" },
  { id: "ultra", name: "Ultra", description: "" },
];

it("cycles standard, fast, and ultra, then returns to standard", () => {
  expect(cycleServiceTier(tiers, null)).toEqual({ id: "fast", label: "快速" });
  expect(cycleServiceTier(tiers, "fast")).toEqual({ id: "ultra", label: "超快" });
  expect(cycleServiceTier(tiers, "ultra")).toEqual({ id: null, label: "标准" });
});

it("stays unset when the catalog has no speed tier", () => {
  expect(cycleServiceTier([], null)).toBeNull();
});
