import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import FilesPanel from "./FilesPanel";
import { useEditorStore } from "@session/stores/useEditorStore";

import { resolveWorkspaceFileReference } from "@session/services/workspaceFiles";
import { canonicalizePath } from "@session/services/apiAdapt/filesystem";
vi.mock("@session/services/apiAdapt/filesystem", () => ({
  canonicalizePath: vi.fn(async (path: string) => path),
  readDirectory: vi.fn(async () => []),
}));
vi.mock("@session/services/workspaceFiles", () => ({
  resolveWorkspaceFileReference: vi.fn(async (root: string, path: string) => ({
    root,
    path,
  })),
}));
const fixture = vi.hoisted(() => ({
  cwd: "/fixture",
  projects: ["/fixture"],
  filePath: null as string | null,
}));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@session/stores", async () => ({
  useEditorStore: (await import("@session/stores/useEditorStore"))
    .useEditorStore,
  useWorkspaceStore: () => ({ cwd: fixture.cwd, projects: fixture.projects }),
}));
vi.mock("./FileOperations", () => ({
  FileOperations: ({
    target,
    root,
    action,
  }: {
    target?: { path: string; isDir: boolean } | null;
    root?: string | null;
    action?: { path: string } | null;
  }) => (
    <>
      <output aria-label="文件操作范围">{root}</output>
      <output aria-label="文件操作对话框">{action?.path ?? ""}</output>
      <output aria-label="文件操作目标">
        {target
          ? `${target.path}:${target.isDir ? "目录" : "文件"}`
          : "项目根目录"}
      </output>
    </>
  ),
}));
vi.mock("./explorer", () => ({
  FileTree: ({
    onNodeSelect,
    onFileSelect,
    folder,
    selectedPath,
    onFileAction,
  }: {
    onNodeSelect?: (node: unknown) => void;
    onFileSelect: (path: string) => void;
    folder: string;
    selectedPath?: string;
    onFileAction: (type: string, node: unknown) => void;
  }) => (
    <div>
      <output aria-label="当前文件树">{folder}</output>
      <output aria-label="文件树选中项">{selectedPath}</output>
      <button
        onClick={() =>
          onFileAction("new-file", {
            name: "src",
            path: fixture.cwd + "/src",
            kind: "dir",
          })
        }
      >
        在测试目录新建
      </button>
      <button
        onClick={() =>
          onNodeSelect?.({
            name: "src",
            path: fixture.cwd + "/src",
            kind: "dir",
          })
        }
      >
        选择测试目录
      </button>
      <button
        onClick={() =>
          onFileSelect(fixture.filePath ?? fixture.cwd + "/readme.md")
        }
      >
        选择测试文件
      </button>
    </div>
  ),
  FileViewer: () => <div>文件内容</div>,
}));
beforeEach(() => {
  vi.mocked(resolveWorkspaceFileReference)
    .mockReset()
    .mockImplementation(async (root, path) => ({ root, path }));
  fixture.cwd = "/fixture";
  fixture.projects = ["/fixture"];
  fixture.filePath = null;
  useEditorStore.getState().resetFiles();
});
test("directory selection supplies its own upload target without opening an editor", () => {
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/fixture/src:目录",
  );
  expect(useEditorStore.getState().openFiles).toEqual([]);
});
test("a linked directory uses its canonical external path for file operations", async () => {
  vi.mocked(canonicalizePath).mockResolvedValueOnce("/outside/real-dir");
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  await waitFor(() =>
    expect(screen.getByLabelText("文件操作目标").textContent).toBe(
      "/outside/real-dir:目录",
    ),
  );
  expect(screen.getByLabelText("文件操作范围").textContent).toBe("/");
  expect(screen.getByLabelText("文件树选中项").textContent).toBe(
    "/fixture/src",
  );
});
test("a directory resolution failure disables file actions instead of guessing a target", async () => {
  vi.mocked(canonicalizePath).mockRejectedValueOnce(new Error("目录无法访问"));
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.click(screen.getByText("选择测试目录"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("目录无法访问"),
    );
    expect(screen.getByLabelText("文件操作范围").textContent).toBe("");
    fireEvent.drop(screen.getByRole("region", { name: "会话文件管理" }), {
      dataTransfer: {
        files: [new File(["x"], "x.txt")],
        items: [],
        types: ["Files"],
      },
    });
    expect(uploaded).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("workspace-files-upload", uploaded);
  }
});
test("a malformed canonical directory response cannot become an operation target", async () => {
  vi.mocked(canonicalizePath).mockResolvedValueOnce("relative/unsafe");
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("有效的本机目录"),
  );
  expect(screen.getByLabelText("文件操作范围").textContent).toBe("");
});
test("a late directory resolution cannot alter another project's operation target", async () => {
  let complete!: (path: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  await act(async () => complete("/outside"));
  expect(screen.getByLabelText("文件操作目标").textContent).toBe("项目根目录");
  expect(screen.getByLabelText("文件操作范围").textContent).toBe(
    "/another-project",
  );
});
test("selecting a different node cancels a pending directory action", async () => {
  let complete!: (path: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("在测试目录新建"));
  fireEvent.click(screen.getByText("选择测试目录"));
  await act(async () => complete("/outside"));
  expect(screen.getByLabelText("文件操作对话框").textContent).toBe("");
});
test("project switches discard the previous selected directory", () => {
  const view = render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  expect(screen.getByLabelText("文件操作目标").textContent).toBe("项目根目录");
});
test("browse outside the project without changing the session workspace", async () => {
  const view = render(<FilesPanel />);
  fireEvent.change(screen.getByLabelText("文件浏览路径"), {
    target: { value: "/outside" },
  });
  fireEvent.submit(screen.getByLabelText("文件浏览路径").closest("form")!);
  await waitFor(() =>
    expect(screen.getByLabelText("当前文件树").textContent).toBe("/outside"),
  );
  expect(fixture.cwd).toBe("/fixture");
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/outside:目录",
  );
  fireEvent.click(screen.getByRole("button", { name: "返回上级目录" }));
  await waitFor(() =>
    expect(screen.getByLabelText("当前文件树").textContent).toBe("/"),
  );
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  expect(screen.getByLabelText("当前文件树").textContent).toBe(
    "/another-project",
  );
});
test("a late navigation cannot replace the directory of a newly selected project", async () => {
  let complete!: (value: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(<FilesPanel />);
  fireEvent.change(screen.getByLabelText("文件浏览路径"), {
    target: { value: "/outside" },
  });
  fireEvent.submit(screen.getByLabelText("文件浏览路径").closest("form")!);
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  await act(async () => {
    complete("/outside");
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(screen.getByLabelText("当前文件树").textContent).toBe(
      "/another-project",
    ),
  );
  expect(
    (screen.getByLabelText("文件浏览路径") as HTMLInputElement).value,
  ).toBe("/another-project");
});
test("a pending navigation cannot upload to the previous directory", async () => {
  let complete!: (path: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.change(screen.getByLabelText("文件浏览路径"), {
      target: { value: "/outside" },
    });
    fireEvent.submit(screen.getByLabelText("文件浏览路径").closest("form")!);
    fireEvent.drop(screen.getByRole("region", { name: "会话文件管理" }), {
      dataTransfer: {
        files: [new File(["x"], "x.txt")],
        items: [],
        types: ["Files"],
      },
    });
    expect(uploaded).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("正在切换目录");
    await act(async () => complete("/outside"));
    expect(screen.getByLabelText("当前文件树").textContent).toBe("/outside");
  } finally {
    window.removeEventListener("workspace-files-upload", uploaded);
  }
});
test("typing a new path cancels an older pending navigation", async () => {
  let complete!: (path: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<FilesPanel />);
  const input = screen.getByLabelText("文件浏览路径") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "/first" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.change(input, { target: { value: "/second" } });
  await act(async () => complete("/first"));
  expect(input.value).toBe("/second");
  expect(screen.getByLabelText("当前文件树").textContent).toBe("/fixture");
});
test("a project switch keeps an already opened external file and its local access root", () => {
  useEditorStore.getState().openFile("/outside/file.ts", "/");
  const view = render(<FilesPanel />);
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  expect(useEditorStore.getState().activeFile).toBe("/outside/file.ts");
  expect(useEditorStore.getState().roots["/outside/file.ts"]).toBe("/");
  expect(screen.getByText("文件内容")).toBeTruthy();
});
test("an external chat link selects the visible file as the toolbar target", async () => {
  render(<FilesPanel />);
  act(() =>
    useEditorStore.getState().revealFile("/outside/from-chat.txt", "/", 2),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("文件操作目标").textContent).toBe(
      "/outside/from-chat.txt:文件",
    ),
  );
  expect(screen.getByLabelText("文件操作范围").textContent).toBe("/");
  fireEvent.change(screen.getByLabelText("文件浏览路径"), {
    target: { value: "/different" },
  });
  fireEvent.submit(screen.getByLabelText("文件浏览路径").closest("form")!);
  await waitFor(() =>
    expect(screen.getByLabelText("文件操作目标").textContent).toBe(
      "/different:目录",
    ),
  );
});
test("files and opened tabs select the corresponding file actions", async () => {
  useEditorStore.getState().openFile("/fixture/other.ts", "/fixture");
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试文件"));
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe("/fixture/readme.md"),
  );
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/fixture/readme.md:文件",
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件 other.ts" }));
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/fixture/other.ts:文件",
  );
});
test("dropping files uploads to the selected directory rather than the project root", async () => {
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.click(screen.getByText("选择测试目录"));
    await waitFor(() =>
      expect(screen.getByLabelText("文件操作范围").textContent).toBe(
        "/fixture",
      ),
    );
    const files = [new File(["payload"], "upload.txt")];
    fireEvent.drop(screen.getByRole("region", { name: "会话文件管理" }), {
      dataTransfer: { files, items: [], types: ["Files"] },
    });
    expect(uploaded).toHaveBeenCalledOnce();
    expect(uploaded.mock.calls[0][0].detail).toEqual({
      root: "/fixture",
      dir: "/fixture/src",
      files,
    });
  } finally {
    window.removeEventListener("workspace-files-upload", uploaded);
  }
});
test("a drop cannot silently target the wrong directory while a link is resolving", async () => {
  let complete!: (path: string) => void;
  vi.mocked(canonicalizePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.click(screen.getByText("选择测试目录"));
    fireEvent.drop(screen.getByRole("region", { name: "会话文件管理" }), {
      dataTransfer: {
        files: [new File(["x"], "x.txt")],
        items: [],
        types: ["Files"],
      },
    });
    expect(uploaded).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("正在解析所选目录");
    await act(async () => complete("/outside"));
    expect(screen.getByLabelText("文件操作范围").textContent).toBe("/");
  } finally {
    window.removeEventListener("workspace-files-upload", uploaded);
  }
});

test("dropping a folder reports the unsupported input instead of uploading an empty placeholder", () => {
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.drop(screen.getByRole("region", { name: "会话文件管理" }), {
      dataTransfer: {
        files: [new File([], "folder")],
        types: ["Files"],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    });
    expect(screen.getByRole("alert").textContent).toContain("仅支持文件");
    expect(uploaded).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("workspace-files-upload", uploaded);
  }
});

test("file tree selection resolves linked files into their registered real project", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/dependency",
    path: "/dependency/readme.md",
  });
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试文件"));
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe("/dependency/readme.md"),
  );
  expect(useEditorStore.getState().roots["/dependency/readme.md"]).toBe(
    "/dependency",
  );
});

test("canonical entries returned under a linked directory use their known registered project", async () => {
  fixture.projects = ["/fixture", "/dependency"];
  fixture.filePath = "/dependency/readme.md";
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试文件"));
  await waitFor(() =>
    expect(resolveWorkspaceFileReference).toHaveBeenCalledWith(
      "/dependency",
      "/dependency/readme.md",
    ),
  );
});

test("a canonical file beneath a linked external directory remains the operation target", async () => {
  fixture.filePath = "/outside/readme.md";
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/",
    path: "/outside/readme.md",
  });
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试文件"));
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe("/outside/readme.md"),
  );
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/outside/readme.md:文件",
  );
  expect(screen.getByLabelText("文件操作范围").textContent).toBe("/");
});
