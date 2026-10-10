import { expect, it } from "vitest";
import { nativeDiffLines } from "./nativeDiffLines";
import { selectNativeDiffRange } from "./nativeDiffSelection";

const lines = nativeDiffLines("", "", "@@ -80,2 +90,3 @@\n-before\n+after\n+extra\n context\n@@ -200 +220 @@\n-old\n+new\n");
it("captures side and original coordinates without borrowing the other side", () => {
  expect(selectNativeDiffRange(lines, "new", 91, 90)).toEqual({ side: "new", start: 90, end: 91, content: "after\nextra" });
  expect(selectNativeDiffRange(lines, "old", 80, 81)).toEqual({ side: "old", start: 80, end: 81, content: "before\ncontext" });
});
it("refuses missing coordinates and gaps between hunks", () => {
  expect(selectNativeDiffRange(lines, "new", 90, 220)).toBeNull();
  expect(selectNativeDiffRange(lines, "old", 90, 90)).toBeNull();
});
