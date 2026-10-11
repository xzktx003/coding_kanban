import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores";
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
it("expands MCP arguments with the plugin label", () => {
  render(
    <McpToolCallItem
      item={{ ...base, status: "completed", arguments: { note: "检查当前文件" } } as never}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  const toggle = screen.getByRole("button", { name: "展开 参数" });
  expect(toggle.getAttribute("title")).toBe("展开");
  fireEvent.click(toggle);
  expect(screen.getByText(/检查当前文件/)).toBeTruthy();
});
it("shows four argument fields and reveals the rest", () => {
  render(
    <McpToolCallItem
      item={{
        ...base,
        status: "completed",
        arguments: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" },
      } as never}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  fireEvent.click(screen.getByRole("button", { name: "展开 参数" }));
  expect(screen.queryByText(/"e"/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "再显示 2 项" }));
  expect(screen.getByText(/"f"/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "收起部分条目" }));
  expect(screen.queryByText(/"f"/)).toBeNull();
});
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

it("opens a resource from the plugin open-in menu", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  useEditorStore.setState({
    activeFile: null,
    openFiles: [],
    revealLocation: null,
  });
  useLayoutStore.setState({ isRightPanelOpen: false });
  render(
    <McpToolCallItem
      item={
        {
          ...base,
          status: "completed",
          result: {
            content: [
              {
                type: "resource_link",
                uri: "https://example.invalid/resource",
                name: "资源文档",
              },
              {
                type: "resource",
                resource: { uri: "file:///project/note.md", text: "嵌入资源" },
              },
            ],
            structuredContent: null,
          },
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  const openers = screen.getAllByRole("button", { name: "打开方式" });
  fireEvent.click(openers[0]);
  expect(screen.getByRole("menu", { name: "选择打开位置" })).toBeTruthy();
  expect(
    screen.getByRole("menuitem", { name: "在默认浏览器中打开" }).getAttribute("href"),
  ).toBe("https://example.invalid/resource");
  fireEvent.click(screen.getByRole("menuitem", { name: "复制链接" }));
  expect(writeText).toHaveBeenCalledWith("https://example.invalid/resource");
  fireEvent.click(screen.getAllByRole("button", { name: "打开方式" })[1]);
  fireEvent.click(screen.getByRole("menuitem", { name: "在文件管理器中显示" }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  expect(useEditorStore.getState().activeFile).toBe("/project/note.md");
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
