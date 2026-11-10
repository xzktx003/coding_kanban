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
  watch: undefined as
    | undefined
    | ((event: { path: string; kind: string }) => void),
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
import {
  beginFileOperation,
  beginFileSave,
  useFileSaveStatusStore,
} from "@session/stores/useFileSaveStatusStore";
vi.mock("@session/hooks/useDirWatch", () => ({
  useDirWatch: (_path: string | null, callback: typeof io.watch) => {
    io.watch = callback;
  },
}));
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
  useFileSaveStatusStore.setState({ pending: new Map(), failures: new Map() });
  io.read.mockReset();
  io.write.mockReset();
  io.watch = undefined;
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

test("while a file save is pending the editor remains editable but cannot save again", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  let finish!: ReturnType<typeof beginFileSave>;
  act(() => {
    finish = beginFileSave("/fixture/a.ts");
  });
  expect(
    (
      screen.getByRole("button", {
        name: "保存文件（Ctrl+S）",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(fireEvent.keyDown(editor, { key: "s", ctrlKey: true })).toBe(false);
  expect(io.write).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: "保存过程中继续输入" } });
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "保存过程中继续输入",
  );
  act(() => finish({ ok: true }));
  expect(
    (
      screen.getByRole("button", {
        name: "保存文件（Ctrl+S）",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("an operation on the containing folder temporarily prevents saving but preserves edits", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  let finish!: ReturnType<typeof beginFileOperation>;
  act(() => {
    finish = beginFileOperation("/fixture", true);
  });
  expect(
    (
      screen.getByRole("button", {
        name: "保存文件（Ctrl+S）",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "操作完成前不能保存",
  );
  expect(fireEvent.keyDown(editor, { key: "s", ctrlKey: true })).toBe(false);
  fireEvent.change(editor, { target: { value: "操作期间输入" } });
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "操作期间输入",
  );
  act(() => finish());
  expect(
    (
      screen.getByRole("button", {
        name: "保存文件（Ctrl+S）",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("closing a clean-looking file still warns while an earlier save is pending", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<RightPanel />);
  await screen.findByRole(
    "textbox",
    { name: "隔离真实编辑器状态" },
    { timeout: 5000 },
  );
  let finish!: ReturnType<typeof beginFileSave>;
  act(() => {
    finish = beginFileSave("/fixture/a.ts");
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭文件 a.ts" }));
  expect(screen.getByRole("dialog").textContent).toContain("正在保存");
  expect(
    (screen.getByRole("button", { name: "关闭文件" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(useEditorStore.getState().openFiles).toContain("/fixture/a.ts");
  act(() => finish({ ok: true }));
});

async function openChangedFileDialog() {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  io.files.set("/fixture/a.ts", "磁盘新版本");
  act(() =>
    useFileDocumentStore
      .getState()
      .load("/fixture/a.ts", "/fixture", "磁盘新版本", "磁盘新版本"),
  );
  fireEvent.click(screen.getByRole("button", { name: "比较并重新读取" }));
  await screen.findByText("磁盘内容：磁盘新版本");
}

test("a failed confirmed disk reload preserves the unsaved draft", async () => {
  await openChangedFileDialog();
  io.read.mockRejectedValueOnce(new Error("磁盘重新读取失败"));
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "磁盘重新读取失败",
  );
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/a.ts"].draft,
    ).toBe("磁盘新版本"),
  );
});

test("a failed comparison cannot discard a draft and offers a retry", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  io.files.set("/fixture/a.ts", "磁盘新版本");
  act(() =>
    useFileDocumentStore
      .getState()
      .load("/fixture/a.ts", "/fixture", "磁盘新版本", "磁盘新版本"),
  );
  io.read.mockRejectedValueOnce(new Error("比较读取失败"));
  fireEvent.click(screen.getByRole("button", { name: "比较并重新读取" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "比较读取失败",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "放弃草稿并重新读取",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试读取磁盘内容" }));
  await screen.findByText("磁盘内容：磁盘新版本");
  expect(
    (
      screen.getByRole("button", {
        name: "放弃草稿并重新读取",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("a disk change after comparison requires a new confirmation and keeps the draft", async () => {
  await openChangedFileDialog();
  io.files.set("/fixture/a.ts", "又一次磁盘更新");
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await screen.findByText("磁盘内容：又一次磁盘更新");
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/a.ts"],
    ).toMatchObject({
      base: "又一次磁盘更新",
      draft: "又一次磁盘更新",
      version: "又一次磁盘更新",
      diskChanged: false,
    }),
  );
});

test("a newer draft is never discarded by an earlier in-flight reload", async () => {
  await openChangedFileDialog();
  let finish!: (content: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  act(() =>
    useFileDocumentStore.getState().edit("/fixture/a.ts", "读取中产生的新草稿"),
  );
  await act(async () => finish("磁盘新版本"));
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "读取中产生的新草稿",
  );
  expect(screen.getByRole("alert").textContent).toContain("草稿");
});

test("cancelling a pending confirmed reload keeps the draft when the old read returns", async () => {
  await openChangedFileDialog();
  let finish!: (content: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  fireEvent.click(screen.getByRole("button", { name: "保留草稿" }));
  await act(async () => finish("磁盘新版本"));
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("an older file-watch read cannot undo a confirmed disk reload", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  io.files.set("/fixture/a.ts", "磁盘新版本");
  act(() =>
    useFileDocumentStore
      .getState()
      .load("/fixture/a.ts", "/fixture", "磁盘新版本", "磁盘新版本"),
  );
  let finish!: (content: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => io.watch?.({ path: "/fixture/a.ts", kind: "modify" }));
  fireEvent.click(screen.getByRole("button", { name: "比较并重新读取" }));
  await screen.findByText("磁盘内容：磁盘新版本");
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/a.ts"].draft,
    ).toBe("磁盘新版本"),
  );
  await act(async () => finish("迟到的旧磁盘内容"));
  expect(
    useFileDocumentStore.getState().documents["/fixture/a.ts"],
  ).toMatchObject({
    base: "磁盘新版本",
    draft: "磁盘新版本",
    version: "磁盘新版本",
  });
});

test("a fresh read after confirmed reload observes a concurrent file-watch change", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  act(() =>
    useFileDocumentStore
      .getState()
      .load("/fixture/a.ts", "/fixture", "磁盘新版本", "磁盘新版本"),
  );
  let finishOld!: (content: string) => void;
  io.read
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce("磁盘新版本")
    .mockResolvedValueOnce("磁盘新版本")
    .mockResolvedValueOnce("确认后磁盘又变化");
  act(() => io.watch?.({ path: "/fixture/a.ts", kind: "modify" }));
  fireEvent.click(screen.getByRole("button", { name: "比较并重新读取" }));
  await screen.findByText("磁盘内容：磁盘新版本");
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/a.ts"].draft,
    ).toBe("确认后磁盘又变化"),
  );
  await act(async () => finishOld("迟到的旧内容"));
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "确认后磁盘又变化",
  );
});

test("a delayed comparison from a previous file cannot affect the newly opened file", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  io.files.set("/fixture/b.ts", "另一个文件");
  const view = render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "未保存草稿" } });
  act(() =>
    useFileDocumentStore
      .getState()
      .load("/fixture/a.ts", "/fixture", "磁盘新版本", "磁盘新版本"),
  );
  let finish!: (content: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "比较并重新读取" }));
  view.rerender(<FileViewer filePath="/fixture/b.ts" />);
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/b.ts"]?.draft,
    ).toBe("另一个文件"),
  );
  await act(async () => finish("迟到的 A 内容"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useFileDocumentStore.getState().documents["/fixture/a.ts"].draft).toBe(
    "未保存草稿",
  );
  expect(useFileDocumentStore.getState().documents["/fixture/b.ts"].draft).toBe(
    "另一个文件",
  );
});

test("a file-watch update while a Markdown save is pending does not leave save disabled", async () => {
  io.files.set("/fixture/a.md", "磁盘原文");
  let finish!: () => void;
  io.write.mockImplementationOnce(
    async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<FileViewer filePath="/fixture/a.md" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "更新内容" } });
  const save = screen.getByRole("button", { name: /^保存$/ });
  fireEvent.click(save);
  await waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
  act(() => io.watch?.({ path: "/fixture/a.md", kind: "modify" }));
  await act(async () => {});
  await act(async () => finish());
  expect((save as HTMLButtonElement).disabled).toBe(false);
});

test("an old file-watch read cannot undo an acknowledged save", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "已确认保存的新内容" } });
  let finish!: (content: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => io.watch?.({ path: "/fixture/a.ts", kind: "modify" }));
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  await waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      useFileDocumentStore.getState().documents["/fixture/a.ts"].base,
    ).toBe("已确认保存的新内容"),
  );
  await act(async () => finish("磁盘原文"));
  expect(
    useFileDocumentStore.getState().documents["/fixture/a.ts"],
  ).toMatchObject({
    base: "已确认保存的新内容",
    draft: "已确认保存的新内容",
    version: "已确认保存的新内容",
  });
});

test("the fresh read after a save preserves subsequent typing when the disk changes again", async () => {
  io.files.set("/fixture/a.ts", "磁盘原文");
  render(<FileViewer filePath="/fixture/a.ts" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "保存快照" } });
  let finishOld!: (content: string) => void;
  let finishFresh!: (content: string) => void;
  io.read
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce("磁盘原文")
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishFresh = resolve;
        }),
    );
  act(() => io.watch?.({ path: "/fixture/a.ts", kind: "modify" }));
  fireEvent.click(screen.getByRole("button", { name: "保存文件（Ctrl+S）" }));
  await waitFor(() => expect(finishFresh).toBeTypeOf("function"));
  fireEvent.change(editor, { target: { value: "保存后继续输入" } });
  await act(async () => finishFresh("另一个进程的新内容"));
  await act(async () => finishOld("磁盘原文"));
  expect(
    useFileDocumentStore.getState().documents["/fixture/a.ts"],
  ).toMatchObject({
    base: "保存快照",
    draft: "保存后继续输入",
    version: "保存快照",
    diskChanged: true,
  });
});

test("a late Markdown save failure does not show an error for a different file", async () => {
  io.files.set("/fixture/a.md", "原始 A");
  io.files.set("/fixture/b.md", "原始 B");
  let fail!: (error: Error) => void;
  io.write.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const view = render(<FileViewer filePath="/fixture/a.md" />);
  const editor = await screen.findByRole("textbox", {
    name: "隔离真实编辑器状态",
  });
  fireEvent.change(editor, { target: { value: "A 的未保存内容" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
  view.rerender(<FileViewer filePath="/fixture/b.md" />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "隔离真实编辑器状态",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("原始 B"),
  );
  await act(async () => fail(new Error("A 的延迟保存失败")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(useFileDocumentStore.getState().documents["/fixture/a.md"].draft).toBe(
    "A 的未保存内容",
  );
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
