import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
afterEach(() => vi.restoreAllMocks());

it("retains a reader's wrap choice when a streaming fence completes", async () => {
  const value = "```typescript\nconst value = 1;\n```";
  const view = render(<CodexMarkdown value={value} streaming />);
  fireEvent.click(await screen.findByRole("button", { name: "启用自动换行" }));
  view.rerender(<CodexMarkdown value={value} streaming={false} />);
  expect(
    screen
      .getByRole("button", { name: "禁用自动换行" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it("copies the selected table rather than preceding Markdown or another table", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const value =
    "An introduction.\n\n| First | Value |\n| --- | --- |\n| A | one |\n\nAnother paragraph.\n\n| Second | Value |\n| --- | --- |\n| B | two |";
  render(<CodexMarkdown value={value} />);
  const copies = await screen.findAllByRole("button", { name: "复制表格" });
  fireEvent.click(copies[1]);
  await screen.findByRole("button", { name: "已复制" });
  expect(writeText).toHaveBeenCalledWith(
    "| Second | Value |\n| --- | --- |\n| B | two |",
  );
});
