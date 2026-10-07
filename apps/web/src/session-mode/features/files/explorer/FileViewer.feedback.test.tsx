import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileViewer } from "./FileViewer";
const io = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@session/services", () => ({
  readTextFile: io.read,
  canonicalizePath: async (p: string) => p,
  writeFile: vi.fn(),
}));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (_root: string, path: string) => {
    const content = await io.read(path);
    return { path, content, version: content, size: content?.length ?? 0 };
  },
  saveWorkspaceText: vi.fn(),
}));
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("@session/stores", () => ({
  useInputStore: () => ({ setInputValue: vi.fn() }),
}));
vi.mock("../editor/CodeEditor", () => ({
  CodeEditor: ({ content }: { content: string }) => (
    <div data-testid="editor">{content}</div>
  ),
}));
vi.mock("./OfficeView", () => ({ OfficeView: () => null }));
beforeEach(() => {
  io.read.mockReset();
  useFileDocumentStore.setState({ documents: {} });
});
test("file loading is named and announced", () => {
  io.read.mockReturnValue(new Promise(() => {}));
  render(<FileViewer filePath="/fixture/中文.ts" />);
  expect(screen.getByRole("status").textContent).toContain("正在加载文件");
});
test("file read failure offers retry and keeps file identity", async () => {
  io.read
    .mockRejectedValueOnce(new Error("隔离读取错误"))
    .mockResolvedValueOnce("重试成功");
  render(<FileViewer filePath="/fixture/中文.ts" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "隔离读取错误",
  );
  fireEvent.click(screen.getByRole("button", { name: "重新读取文件" }));
  await screen.findByText("重试成功");
  expect(io.read).toHaveBeenLastCalledWith("/fixture/中文.ts");
});
