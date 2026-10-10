import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ToolContent } from "./ToolContent";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
it("preserves native MCP text as plaintext with an explicit block title", () => {
  render(
    <ToolContent
      content={[
        {
          type: "text",
          text: "**literal tool result**\n[not a message link](https://example.invalid)",
        },
      ]}
    />,
  );
  expect(screen.getByText("纯文本")).toBeTruthy();
  expect(screen.getByText(/literal tool result/).tagName).toBe("PRE");
  expect(screen.queryByRole("link")).toBeNull();
});
