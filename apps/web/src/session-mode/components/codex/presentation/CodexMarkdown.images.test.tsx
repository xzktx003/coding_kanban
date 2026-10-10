import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
vi.mock("@session/contexts/ThemeContext", () => ({ useThemeContext: () => ({ resolvedTheme:"dark" }) }));
it("renders interactive Markdown images without nesting a block gallery inside a paragraph", async () => {
  const { container } = render(<CodexMarkdown value={'Before the image.\n\n![Preview](https://fixture.invalid/image.png)\n\nAfter the image.'} />);
  expect(await screen.findByRole("img", { name:"Preview" })).toBeTruthy();
  expect(container.querySelector("p div")).toBeNull();
  expect(screen.getByText("Before the image.").tagName).toBe("P");
  expect(screen.getByText("After the image.").tagName).toBe("P");
});
