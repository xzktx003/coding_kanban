import { expect, it } from "vitest";
import { nativeMathMarkdown } from "./nativeMath";
it("uses the original plugin delimiters while keeping currency and dollar notation literal", () => {
  expect(nativeMathMarkdown("Cost $5, $x$ and $$y$$; \\(x^2\\).")).toBe(
    "Cost \\$5, \\$x\\$ and \\$\\$y\\$\\$; $x^2$.",
  );
  expect(nativeMathMarkdown("\\[\nx^2\n\\]")).toBe("\n$$\n\nx^2\n\n$$\n");
});
it("does not rewrite code, quoted fences or indented code", () => {
  const source =
    "`\\(x\\) $5`\n\n```python\nprint('$5', r'\\(x\\)')\n```\n\n> ```text\n> \\(x\\) $5\n> ```\n\n    \\(x\\) $5\n";
  expect(nativeMathMarkdown(source)).toBe(source);
});
it("keeps unfinished native delimiters literal until their closure arrives", () => {
  expect(nativeMathMarkdown("\\(pending")).toBe("\\(pending");
  expect(nativeMathMarkdown("\\(complete\\)")).toBe("$complete$");
});
