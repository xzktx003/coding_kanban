import { expect, it } from "vitest";
import { cleanMarkdown, exportThreadMarkdown } from "./model";
const directive =
  ':codex-file-citation{path="/owner/src/file.ts" line_range_start="42" line_range_end="45"}';
it("copies native file-citation labels and full ranges without leaking directive control syntax", () => {
  expect(
    cleanMarkdown(
      `Source ${directive} and 【/owner/src/second.py†L8-L9】`,
      "zh-CN",
    ),
  ).toBe("Source file.ts （第 42-45 行） and second.py （第 8-9 行）");
  const markdown = exportThreadMarkdown([
    {
      rowId: "row",
      itemId: "item",
      turnId: "turn",
      role: "assistant",
      text: directive,
      completed: true,
    },
  ]);
  expect(markdown).toContain("file.ts (lines 42-45)");
  expect(markdown).not.toContain("codex-file-citation");
});
it("preserves citation literals in code, escaped text, HTML, links and images", () => {
  const source = [
    `\`${directive}\``,
    `\`\`\`text\n${directive}\n\`\`\``,
    `\\${directive}`,
    `<div>${directive}</div>`,
    '[link](:codex-file-citation{path="/owner/file.ts"})',
    '![image :codex-file-citation{path="/owner/file.ts"}](https://example.invalid/image.png)',
  ].join("\n\n");
  expect(cleanMarkdown(source)).toBe(source);
});
it("does not replace an earlier identical inline-code example or mutate the message source", () => {
  const source = `\`${directive}\` then ${directive}`;
  expect(cleanMarkdown(source)).toBe(
    `\`${directive}\` then file.ts (lines 42-45)`,
  );
  expect(source).toContain(directive);
});
