import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { McpToolCallItem } from "./McpToolCallItem";
import { ReasoningSummaryItem } from "./ReasoningSummaryItem";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
it("keeps native MCP collapsed through progress and exposes call identity and args only on request", () => {
  const item = {
    type: "mcpToolCall",
    id: "tool-id",
    server: "workspace",
    tool: "inspect_repository",
    arguments: { path: "secret-owner.ts" },
    status: "inProgress",
    result: null,
    error: null,
    durationMs: null,
  };
  const { rerender } = render(<McpToolCallItem item={item as never} />);
  expect(
    screen.queryByRole("button", { name: /Inspect repository/ }),
  ).toBeNull();
  expect(screen.queryByText(/secret-owner.ts/)).toBeNull();
  rerender(
    <McpToolCallItem
      item={
        {
          ...item,
          status: "completed",
          result: { content: [{ type: "text", text: "Result body" }] },
        } as never
      }
    />,
  );
  expect(
    screen
      .getByRole("button", { name: /Inspect repository/ })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /Inspect repository/ }));
  expect(screen.getByText("Result body")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "显示原始工具调用输出" }));
  expect(screen.getByRole("dialog").textContent).toContain("secret-owner.ts");
  expect(screen.getByRole("dialog").textContent).toContain("tool-id");
});
it("reports only observed reasoning duration and never invents elapsed time on a historical mount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  try {
    const { rerender, unmount } = render(
      <ReasoningSummaryItem summary={["Visible public body"]} running />,
    );
    act(() => vi.advanceTimersByTime(3400));
    rerender(<ReasoningSummaryItem summary={["Visible public body"]} />);
    expect(screen.getByRole("button", { name: "已思考 3s" })).toBeTruthy();
    unmount();
    render(<ReasoningSummaryItem summary={["Historical public body"]} />);
    expect(screen.getByRole("button", { name: "已完成思考" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
it("shows public streaming summary with native title and collapses completion without exposing raw reasoning", () => {
  const { rerender } = render(
    <ReasoningSummaryItem
      summary={["**Public title**\n\nVisible public body"]}
      running
    />,
  );
  expect(screen.getAllByText("正在思考")[0]).toBeTruthy();
  expect(screen.getByText("Visible public body")).toBeTruthy();
  expect(screen.queryByText("Public title")).toBeNull();
  rerender(
    <ReasoningSummaryItem
      summary={["**Public title**\n\nVisible public body"]}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: /已完成思考/ })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.queryByText("Visible public body")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /已完成思考/ }));
  expect(screen.queryByText("Public title")).toBeNull();
  expect(screen.getByText("Visible public body")).toBeTruthy();
});
