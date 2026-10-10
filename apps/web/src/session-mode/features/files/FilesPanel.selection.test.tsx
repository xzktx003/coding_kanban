import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import FilesPanel from "./FilesPanel";
import { useEditorStore } from "@session/stores/useEditorStore";

const fixture = vi.hoisted(() => ({ cwd: "/fixture" }));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@session/stores", async () => ({
  useEditorStore: (await import("@session/stores/useEditorStore"))
    .useEditorStore,
  useWorkspaceStore: () => ({ cwd: fixture.cwd }),
}));
vi.mock("./FileOperations", () => ({
  FileOperations: ({
    target,
  }: {
    target?: { path: string; isDir: boolean } | null;
  }) => (
    <output aria-label="文件操作目标">
      {target
        ? `${target.path}:${target.isDir ? "目录" : "文件"}`
        : "项目根目录"}
    </output>
  ),
}));
vi.mock("./explorer", () => ({
  FileTree: ({
    onNodeSelect,
    onFileSelect,
  }: {
    onNodeSelect?: (node: unknown) => void;
    onFileSelect: (path: string) => void;
  }) => (
    <div>
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
      <button onClick={() => onFileSelect(fixture.cwd + "/readme.md")}>
        选择测试文件
      </button>
    </div>
  ),
  FileViewer: () => <div>文件内容</div>,
}));
beforeEach(() => {
  fixture.cwd = "/fixture";
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
test("project switches discard the previous selected directory", () => {
  const view = render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试目录"));
  fixture.cwd = "/another-project";
  view.rerender(<FilesPanel />);
  expect(screen.getByLabelText("文件操作目标").textContent).toBe("项目根目录");
});
test("files and opened tabs select the corresponding file actions", () => {
  useEditorStore.getState().openFile("/fixture/other.ts", "/fixture");
  render(<FilesPanel />);
  fireEvent.click(screen.getByText("选择测试文件"));
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/fixture/readme.md:文件",
  );
  fireEvent.click(screen.getByRole("button", { name: "查看文件 other.ts" }));
  expect(screen.getByLabelText("文件操作目标").textContent).toBe(
    "/fixture/other.ts:文件",
  );
});
test("dropping files uploads to the selected directory rather than the project root", () => {
  const uploaded = vi.fn();
  window.addEventListener("workspace-files-upload", uploaded);
  try {
    render(<FilesPanel />);
    fireEvent.click(screen.getByText("选择测试目录"));
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
