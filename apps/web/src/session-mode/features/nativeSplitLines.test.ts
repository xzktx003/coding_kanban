import { expect, it } from "vitest";
import { nativeSplitLines } from "./nativeSplitLines";
import { nativeDiffLines } from "./nativeDiffLines";
it("split view pairs replacement rows without inventing numbers for unequal additions or hunk gaps", () => {
  const lines = nativeDiffLines(
    "",
    "",
    "@@ -115,2 +115,3 @@\n-old\n+new\n+extra\n same\n@@ -307 +308 @@\n-before\n+after\n",
  );
  expect(nativeSplitLines(lines)).toEqual([
    { separator: 0 },
    { left: 1, right: 2 },
    { right: 3 },
    { left: 4, right: 4 },
    { separator: 5 },
    { left: 6, right: 7 },
  ]);
});
