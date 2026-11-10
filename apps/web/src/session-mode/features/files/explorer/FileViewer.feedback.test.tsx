import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileViewer } from "./FileViewer";
const io = vi.hoisted(() => ({ read: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock("@session/services", () => ({
  readTextFile: io.read,
  canonicalizePath: async (p: string) => p,
  writeFile: vi.fn(),
}));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (
    _root: string,
    path: string,
    options?: { signal?: AbortSignal },
  ) => {
    if (options?.signal) io.signals.push(options.signal);
    const content = await io.read(path);
    return { path, content, version: content, size: content?.length ?? 0 };
  },
  saveWorkspaceText: vi.fn(),
}));
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import {
  beginFileSave,
  useFileSaveStatusStore,
} from "@session/stores/useFileSaveStatusStore";
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
  io.signals = [];
  useFileDocumentStore.setState({ documents: {} });
  useFileSaveStatusStore.setState({ pending: new Map(), failures: new Map() });
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

test("a stalled file read becomes retryable instead of loading forever", async () => {
  vi.useFakeTimers();
  try {
    io.read
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce("重新读取的正文");
    const view = render(<FileViewer filePath="/fixture/中文.ts" />);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole("alert").textContent).toContain("超时");
    expect(io.signals[0].aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新读取文件" }));
    await act(async () => {});
    expect(screen.getByTestId("editor").textContent).toBe("重新读取的正文");
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});

test("closing a viewer cancels its pending file read", () => {
  io.read.mockReturnValue(new Promise(() => {}));
  const view = render(<FileViewer filePath="/fixture/中文.ts" />);
  expect(io.signals[0].aborted).toBe(false);
  view.unmount();
  expect(io.signals[0].aborted).toBe(true);
});

test("a detached save failure stays with its file until the user confirms the disk content", async () => {
  io.read.mockResolvedValue("文件内容");
  const view = render(<FileViewer filePath="/fixture/a.ts" />);
  await screen.findByTestId("editor");
  let finish!: ReturnType<typeof beginFileSave>;
  act(() => {
    finish = beginFileSave("/fixture/a.ts");
  });
  expect(screen.getByRole("status").textContent).toContain("保存");
  act(() => finish({ ok: false, error: new Error("连接中断") }));
  expect(screen.getByRole("alert").textContent).toContain("连接中断");
  view.rerender(<FileViewer filePath="/fixture/b.ts" />);
  expect(screen.queryByRole("alert")).toBeNull();
  view.rerender(<FileViewer filePath="/fixture/a.ts" />);
  expect(screen.getByRole("alert").textContent).toContain("连接中断");
  fireEvent.click(screen.getByRole("button", { name: "比较磁盘内容" }));
  await screen.findByText("磁盘内容：文件内容");
  expect(screen.getByRole("dialog").textContent).toContain("可能仍在进行");
  fireEvent.click(screen.getByRole("button", { name: "保留草稿" }));
  expect(screen.getByRole("alert").textContent).toContain("连接中断");
  fireEvent.click(screen.getByRole("button", { name: "比较磁盘内容" }));
  await screen.findByText("磁盘内容：文件内容");
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
