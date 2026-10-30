import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { nativeMathMarkdown } from "./nativeMath";
import { CodexMarkdown } from "./CodexMarkdown";

vi.mock("./nativeMath", async (original) => {
  const module = await original<typeof import("./nativeMath")>();
  return { ...module, nativeMathMarkdown: vi.fn(module.nativeMathMarkdown) };
});
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="normalized-markdown">{children}</div>
  ),
  defaultRemarkPlugins: {},
  defaultRehypePlugins: {},
  defaultUrlTransform: (value: string) => value,
}));

it("normalizes each fragment once and publishes the new source when text changes", () => {
  const normalize = vi.mocked(nativeMathMarkdown);
  normalize.mockClear();
  const { rerender } = render(<CodexMarkdown value={"Answer \\(x^2\\)"} />);
  expect(screen.getByTestId("normalized-markdown").textContent).toBe(
    "Answer $x^2$",
  );
  expect(normalize).toHaveBeenCalledTimes(1);

  rerender(<CodexMarkdown value={"Updated \\[y\\]"} />);
  expect(screen.getByTestId("normalized-markdown").textContent).toBe(
    "Updated $y$",
  );
  expect(normalize).toHaveBeenCalledTimes(2);
});
