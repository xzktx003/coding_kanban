import { expect, it, vi } from "vitest";
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
it("treats the native one-line bracket delimiter as inline math", () => {
  expect(nativeMathMarkdown("Before \\[y\\] after")).toBe("Before $y$ after");
});

it.each([
  "# Reply\n\n" + "ordinary reply without formulas ".repeat(8192),
  "# 常规回复🙂\n`C:\\project\\file.ts`\n\n" +
    "保留 **Markdown** 与 Unicode。".repeat(4096),
])(
  "passes math-free Markdown through without rebuilding its lines",
  (source) => {
    const slice = vi.spyOn(String.prototype, "slice");
    let value: string;
    let slices: number;
    try {
      value = nativeMathMarkdown(source);
      slices = slice.mock.calls.length;
    } finally {
      slice.mockRestore();
    }
    expect(value).toBe(source);
    expect(slices).toBe(0);
  },
);
