import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { McpToolCallItem } from "./McpToolCallItem";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
const base = {
  type: "mcpToolCall",
  id: "mcp",
  server: "workspace",
  tool: "inspect",
  arguments: { path: "file.ts" },
  status: "inProgress",
  result: null,
  error: null,
  durationMs: null,
} as const;
it("keeps in-progress calls compact and reveals real arguments in completed native raw output", () => {
  const { rerender } = render(<McpToolCallItem item={base as never} />);
  expect(screen.queryByRole("button", { name: /Inspect/ })).toBeNull();
  rerender(
    <McpToolCallItem item={{ ...base, status: "completed" } as never} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  fireEvent.click(screen.getByRole("button", { name: "显示原始工具调用输出" }));
  expect(screen.getByText(/file.ts/)).toBeTruthy();
  expect(screen.getByRole("dialog").textContent).toContain('"arguments"');
});
it("renders mixed native content as media and resources with a separate raw view", () => {
  render(
    <McpToolCallItem
      item={
        {
          ...base,
          status: "completed",
          result: {
            content: [
              { type: "text", text: "MCP 文本结果" },
              { type: "image", data: "AA==", mimeType: "image/png" },
              { type: "audio", data: "AA==", mimeType: "audio/wav" },
              {
                type: "resource_link",
                uri: "https://example.invalid/resource",
                name: "资源文档",
              },
              {
                type: "resource",
                resource: {
                  uri: "file:///project/note.md",
                  mimeType: "text/markdown",
                  text: "嵌入资源内容",
                },
              },
            ],
            structuredContent: null,
          },
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  expect(screen.getByText("MCP 文本结果")).toBeTruthy();
  expect(
    screen.getByRole("img", { name: /工具图片/ }).getAttribute("src"),
  ).toBe("data:image/png;base64,AA==");
  expect(document.querySelector("audio[controls]")).not.toBeNull();
  expect(
    screen.getByRole("link", { name: "资源文档" }).getAttribute("href"),
  ).toBe("https://example.invalid/resource");
  expect(screen.getByText("嵌入资源内容")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "显示原始工具调用输出" }),
  ).toBeTruthy();
});

it("labels projected MCP details as unloaded without inventing an empty result or raw response", () => {
  render(
    <McpToolCallItem
      item={
        {
          ...base,
          status: "failed",
          error: { message: "Real failure" },
          transcriptMetadataOnly: true,
        } as never
      }
    />,
  );
  expect(screen.getByText("详情未加载")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  expect(screen.getByRole("alert").textContent).toBe("Real failure");
  expect(screen.queryByText("工具未返回任何内容")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "显示原始工具调用输出" }),
  ).toBeNull();
});
