import "ace-builds/src-noconflict/ace";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileViewer } from "./explorer/FileViewer";
import { RightPanel } from "@session/components/layout/RightPanel";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const io = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  files: new Map<string, string>(),
}));
vi.mock("./explorer/OfficeView", () => ({ OfficeView: () => null }));
vi.mock("react-ace", () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    readOnly: boolean;
  }) => (
    <textarea
      aria-label="隔离真实编辑器状态"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
    />
  ),
}));
vi.mock("@session/services", () => ({
  readTextFile: io.read,
  writeFile: io.write,
  canonicalizePath: async (path: string) => path,
}));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (_root: string, path: string) => {
    const content = await io.read(path);
    return { path, content, version: content, size: content?.length ?? 0 };
  },
  saveWorkspaceText: async (
    _root: string,
    path: string,
    content: string,
    version: string,
  ) => {
    const disk = await io.read(path);
    if (disk !== version) throw new Error("磁盘文件已更新");
    await io.write(path, content);
    io.files.set(path, content);
    return { path, version: content };
  },
  workspaceFileRequest: vi.fn(),
}));
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("@session/hooks/useGitWatch", () => ({ useGitWatch: () => {} }));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("@session/components/layout/RightPanelHeader", () => ({
  RightPanelHeader: () => null,
}));
vi.mock("@session/features/git/GitDiffPanel", () => ({
  default: () => <div>隔离变更页</div>,
}));
vi.mock("@session/features/terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div>隔离终端页</div>,
}));
vi.mock("@session/stores/useGitStatsStore", () => ({
  useGitStatsStore: () => ({ refreshStats: vi.fn() }),
}));
vi.mock("@session/features/web-preview/webFrameworkDetection", () => ({
  detectWebFramework: async () => null,
}));
vi.mock("@session/stores", async () => ({
  useEditorStore: (await import("@session/stores/useEditorStore"))
    .useEditorStore,
  useLayoutStore: (await import("@session/stores/useLayoutStore"))
    .useLayoutStore,
  useWorkspaceStore: () => ({ cwd: "/fixture" }),
  useInputStore: () => ({ setInputValue: vi.fn() }),
}));
beforeEach(() => {
  useFileDocumentStore.setState({ documents: {} });
  io.read.mockReset();
  io.write.mockReset();
  io.files.clear();
  io.read.mockImplementation(async (path: string) => io.files.get(path) ?? "");
  io.write.mockResolvedValue(undefined);
  useEditorStore.setState({
    openFiles: ["/fixture/a.ts"],
    activeFile: "/fixture/a.ts",
  });
  useLayoutStore.setState({
    activeRightPanelTab: "files",
    openRightPanelTabs: ["files", "diff", "terminal"],
    isRightPanelOpen: true,
  });
});
test("large file preview is read-only until full document loads and save preserves its final line", async () => {
  const complete = Array.from({ length: 503 }, (_, i) => `完整行 ${i}`).join(
    "\n",
  );
  io.files.set("/fixture/a.ts", complete);
  render(<RightPanel />);
  const editor = await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  expect((editor as HTMLTextAreaElement).readOnly).toBe(true);
  expect(
    screen.queryByRole("button", { name: "保存文件（Ctrl+S）" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "加载全文以编辑" }));
  expect((editor as HTMLTextAreaElement).value).toContain("完整行 502");
  fireEvent.change(editor, {
    target: { value: complete.replace("完整行 0", "修改首行") },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  await waitFor(() => expect(io.write).toHaveBeenCalled());
  expect(io.write.mock.calls[0][1]).toContain("完整行 502");
});
test("unsaved drafts remain across diff, terminal and other files without hidden CtrlS saves", async () => {
  io.files.set("/fixture/a.ts", "原始A");
  io.files.set("/fixture/b.ts", "原始B");
  render(<RightPanel />);
  const a = await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  fireEvent.change(a, { target: { value: "A未保存草稿" } });
  act(() => useLayoutStore.getState().setActiveRightPanelTab("diff"));
  await screen.findByText("隔离变更页");
  fireEvent.keyDown(document, { key: "s", ctrlKey: true });
  expect(io.write).not.toHaveBeenCalled();
  act(() => useLayoutStore.getState().setActiveRightPanelTab("terminal"));
  await screen.findByText("隔离终端页");
  act(() => {
    useLayoutStore.getState().setActiveRightPanelTab("files");
    useEditorStore.getState().openFile("/fixture/b.ts");
  });
  const b = await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  fireEvent.change(b, { target: { value: "B未保存草稿" } });
  act(() => useEditorStore.getState().setActiveFile("/fixture/a.ts"));
  expect(screen.getByRole("textbox", { name: "隔离真实编辑器状态" })).toBe(a);
  expect((a as HTMLTextAreaElement).value).toBe("A未保存草稿");
  act(() => useEditorStore.getState().setActiveFile("/fixture/b.ts"));
  expect(
    (
      screen.getByRole("textbox", {
        name: "隔离真实编辑器状态",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("B未保存草稿");
});
test("save failure retains the draft and reports a visible actionable error", async () => {
  io.files.set("/fixture/a.ts", "原始A");
  io.write.mockRejectedValueOnce(new Error("隔离写失败"));
  render(<RightPanel />);
  const editor = await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  fireEvent.change(editor, { target: { value: "保留草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "隔离写失败",
  );
  expect((editor as HTMLTextAreaElement).value).toBe("保留草稿");
});

test("editing during a pending save preserves the newest draft after the older snapshot is saved", async () => {
  io.files.set("/fixture/a.ts", "原始A");
  let resolve!: () => void;
  io.write.mockImplementationOnce(async (path: string, content: string) => {
    await new Promise<void>((done) => {
      resolve = done;
    });
    io.files.set(path, content);
  });
  render(<RightPanel />);
  const editor = await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  fireEvent.change(editor, { target: { value: "正在保存的快照" } });
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  await waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
  fireEvent.change(editor, { target: { value: "保存中继续输入的新草稿" } });
  await act(async () => resolve());
  expect((editor as HTMLTextAreaElement).value).toBe("保存中继续输入的新草稿");
  expect(io.files.get("/fixture/a.ts")).toBe("正在保存的快照");
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  await waitFor(() =>
    expect(io.write).toHaveBeenLastCalledWith(
      "/fixture/a.ts",
      "保存中继续输入的新草稿",
    ),
  );
});

test.each(["success", "failure"])(
  "a late %s saving A cannot update or show an error in a reused viewer for B",
  async (outcome) => {
    io.files.set("/fixture/a.ts", "原始A");
    io.files.set("/fixture/b.ts", "原始B");
    let finish!: (value?: unknown) => void;
    io.write.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = outcome === "success" ? resolve : reject;
        }),
    );
    const view = render(<FileViewer filePath="/fixture/a.ts" />);
    const editor = await screen.findByRole(
      "textbox",
      { name: "隔离真实编辑器状态" },
      { timeout: 5000 },
    );
    fireEvent.change(editor, { target: { value: "A保存快照" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
    await waitFor(() =>
      expect(io.write).toHaveBeenCalledWith("/fixture/a.ts", "A保存快照"),
    );
    view.rerender(<FileViewer filePath="/fixture/b.ts" />);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "隔离真实编辑器状态",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("原始B"),
    );
    await act(async () =>
      finish(outcome === "failure" ? new Error("A延迟保存失败") : undefined),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "隔离真实编辑器状态",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("原始B");
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
