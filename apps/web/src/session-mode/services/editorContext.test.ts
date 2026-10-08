import { expect, it } from "vitest";
import { formatEditorContext } from "./editorContext";
it("preserves selected code with a path and line range, including embedded Markdown fences", () => {
  const result = formatEditorContext("/repo/示例.ts", 'const marker = "```";', {
    start: 4,
    end: 6,
  });
  expect(result).toContain("/repo/示例.ts:4-6");
  expect(result).toContain('const marker = "```";');
  expect(result).toContain("````");
});
