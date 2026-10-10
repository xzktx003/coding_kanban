import { expect, it } from "vitest";
import { splitNativePatchFiles } from "./nativePatchPaths";
it("decodes native Git C quotes and octal UTF-8 while preserving literal punctuation", () => {
  const patch = 'diff --git "a/\\346\\227\\245 100%:12\\\\x\\\".ts" "b/\\346\\227\\245 100%:12\\\\x\\\".ts"\n--- "a/\\346\\227\\245 100%:12\\\\x\\\".ts"\n+++ "b/\\346\\227\\245 100%:12\\\\x\\\".ts"\n@@ -80 +80 @@\n-before\n+after\n';
  expect(splitNativePatchFiles(patch)).toEqual([{ path: '日 100%:12\\x".ts', diff: patch }]);
});
it("prefers exact file headers and supports deletion, rename-only and unquoted spaces", () => {
  expect(splitNativePatchFiles("diff --git a/a b/file.ts b/a b/file.ts\n--- a/a b/file.ts\n+++ b/a b/file.ts\n@@ -1 +1 @@\n-a\n+b\n")[0].path).toBe("a b/file.ts");
  expect(splitNativePatchFiles('diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to "new name.ts"\n')[0].path).toBe("new name.ts");
  expect(splitNativePatchFiles('diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -80 +0,0 @@\n-old\n')[0].path).toBe("old.ts");
});
