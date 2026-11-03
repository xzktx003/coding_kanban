import { describe, expect, it } from "vitest";
import { prepareStreamingMarkdown } from "./prepareStreamingMarkdown";

describe("unfinished native-style streaming Markdown", () => {
  it.each([
    ["**标题**\n\n查看 [资料", "**标题**\n\n查看 "],
    ["**标题**\n\n查看 [资料]", "**标题**\n\n查看 "],
    ["**标题**\n\n查看 [资料][来源", "**标题**\n\n查看 "],
    ["**标题**\n\n查看 [资料](https://example.test", "**标题**\n\n查看 "],
    ["脚注[^1]", "脚注"],
    ["![图", ""],
    ["~~~\n`x\n~~~\n[资料", "~~~\n`x\n~~~\n"],
  ])("withholds unfinished syntax in %j", (source, expected) => {
    expect(prepareStreamingMarkdown(source)).toBe(expected);
  });

  it.each([
    "[资料][来源]",
    "[资料][来源]\n\n[来源]: https://example.test",
    "```ts\nconst x = matrix[i][j]",
    "`matrix[i][j]`",
    "matrix[i][j]",
    "- [x]",
    "![图](https://example.test/image.png)",
    "[a `]` b](https://example.test)",
    '[title](https://example.test "a ) title")',
    "\\[literal",
  ])("preserves complete syntax and code in %j", (source) => {
    expect(prepareStreamingMarkdown(source)).toBe(source);
  });
});
