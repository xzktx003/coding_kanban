import { expect, it } from "vitest";
import { pruneRowState } from "./pruneRowState";
it("drops disclosure caches belonging to evicted history rows", () => {
  const keep = new Map<string, unknown>([["expanded", true]]);
  const cache = new Map([
    ["old", new Map<string, unknown>([["body", "large"]])],
    ["visible", keep],
  ]);
  pruneRowState(cache, ["visible"]);
  expect([...cache.keys()]).toEqual(["visible"]);
  expect(cache.get("visible")).toBe(keep);
});
it("bounds visited row state without discarding current visible rows", () => {
  const cache = new Map(
    Array.from({ length: 2000 }, (_, i) => [
      `row-${i}`,
      new Map<string, unknown>(),
    ]),
  );
  pruneRowState(cache, [...cache.keys()], new Set(["row-0", "row-1999"]), 100);
  expect(cache.size).toBe(100);
  expect(cache.has("row-0")).toBe(true);
  expect(cache.has("row-1999")).toBe(true);
});
