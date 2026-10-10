import { expect, it } from "vitest";
import type { HighlightResult } from "@streamdown/code";
import { codexCode } from "./codexCode";

it("uses the actual plugin code-theme palette in both themes", async () => {
  const result = await new Promise<HighlightResult>((resolve) => {
    const immediate = codexCode.highlight(
      { code: "answer = 3", language: "python", themes: codexCode.getThemes() },
      resolve,
    );
    if (immediate) resolve(immediate);
  });
  const number = result.tokens.flat().find((token) => token.content === "3");
  expect(number?.htmlStyle?.["--shiki-dark"]).toBe("#6DCBF4");
  expect(number?.htmlStyle?.color).toBe("#0071EA");
  expect(result.bg).toBe("#ffffff");
  expect(result.fg).toBe("#0d0d0d");
  expect(result.rootStyle).toContain("--shiki-dark-bg:#111111");
  expect(result.rootStyle).toContain("--shiki-dark:#fcfcfc");
});
