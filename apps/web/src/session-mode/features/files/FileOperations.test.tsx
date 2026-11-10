import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { copyTextToClipboard } from "../../../lib/clipboard";
import { FileOperations } from "./FileOperations";
import {
  downloadWorkspaceFile,
  uploadWorkspaceFile,
  workspaceFileRequest,
} from "@session/services/workspaceFiles";
import {
  beginFileSave,
  useFileSaveStatusStore,
} from "@session/stores/useFileSaveStatusStore";

vi.mock("../../../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("@session/services/workspaceFiles", () => ({
  downloadWorkspaceFile: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
  workspaceFileRequest: vi.fn(),
}));

vi.mock("@session/stores/useEditorStore", () => ({
  useEditorStore: {
    getState: () => ({ openFile: vi.fn(), moveFiles: vi.fn(), openFiles: [] }),
  },
}));

vi.mock("@session/stores/useFileDocumentStore", () => ({
  useFileDocumentStore: {
    getState: () => ({ move: vi.fn(), markSaveUnconfirmed: vi.fn() }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useFileSaveStatusStore.setState({
    pending: new Map(),
    failures: new Map(),
    operations: new Map(),
  });
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  vi.mocked(uploadWorkspaceFile).mockResolvedValue({
    path: "/repo/src/upload.txt",
    version: "v1",
  });
  vi.mocked(workspaceFileRequest).mockResolvedValue({ version: "v1" });
});

test("a directory cannot be removed while a file inside it is still saving", async () => {
  const finishSave = beginFileSave("/repo/src/file.ts");
  render(
    <FileOperations
      root="/repo"
      action={{ type: "delete", root: "/repo", path: "/repo/src", isDir: true }}
      onAction={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("正在保存");
  expect(
    (screen.getByRole("button", { name: "确认" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(workspaceFileRequest).not.toHaveBeenCalled();
  act(() => finishSave({ ok: true }));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() =>
    expect(workspaceFileRequest).toHaveBeenCalledWith("trash", {
      root: "/repo",
      path: "/repo/src",
    }),
  );
});

test("a pending directory move blocks new saves inside it but not in another directory", async () => {
  let finishOperation!: (value: unknown) => void;
  vi.mocked(workspaceFileRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOperation = resolve;
      }),
  );
  render(
    <FileOperations
      root="/repo"
      action={{ type: "rename", root: "/repo", path: "/repo/src", isDir: true }}
      onAction={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "文件或文件夹名称" }), {
    target: { value: "renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect(() => beginFileSave("/repo/src/file.ts")).toThrow("文件操作");
  const finishOther = beginFileSave("/repo/src-old/file.ts");
  finishOther({ ok: true });
  await act(async () => finishOperation({ path: "/repo/renamed" }));
  const finishAfter = beginFileSave("/repo/src/file.ts");
  finishAfter({ ok: true });
});

test("a failed file operation releases its save guard and preserves the dialog", async () => {
  vi.mocked(workspaceFileRequest).mockRejectedValueOnce(
    new Error("操作未确认"),
  );
  render(
    <FileOperations
      root="/repo"
      action={{
        type: "delete",
        root: "/repo",
        path: "/repo/src/file.ts",
        isDir: false,
      }}
      onAction={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "操作未确认",
  );
  const finish = beginFileSave("/repo/src/file.ts");
  finish({ ok: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("toolbar actions use the selected directory as their target and show Chinese labels", () => {
  const onAction = vi.fn();
  render(
    <FileOperations
      root="/repo"
      target={{ path: "/repo/src", isDir: true }}
      action={null}
      onAction={onAction}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "新建文件" }));
  expect(onAction).toHaveBeenLastCalledWith({
    type: "new-file",
    root: "/repo",
    path: "/repo/src",
    isDir: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
  const input = screen.getByLabelText("选择上传文件");
  const file = new File(["payload"], "upload.txt");
  fireEvent.change(input, { target: { files: [file] } });

  expect(
    screen.getByRole("toolbar", { name: "文件管理" }).textContent,
  ).toContain("新建文件");
  return waitFor(() =>
    expect(uploadWorkspaceFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/src/upload.txt",
      file,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
});

test("file targets can download and copy absolute or relative paths", async () => {
  const onAction = vi.fn();
  render(
    <FileOperations
      root="/repo"
      target={{ path: "/repo/src/readme.md", isDir: false }}
      action={null}
      onAction={onAction}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
  fireEvent.click(screen.getByRole("button", { name: "复制绝对路径" }));
  fireEvent.click(screen.getByRole("button", { name: "复制相对路径" }));

  await waitFor(() =>
    expect(downloadWorkspaceFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/src/readme.md",
    ),
  );
  expect(copyTextToClipboard).toHaveBeenNthCalledWith(1, "/repo/src/readme.md");
  expect(copyTextToClipboard).toHaveBeenNthCalledWith(2, "src/readme.md");
});

test("root relative path copies as dot and unsupported clipboard shows Chinese feedback", async () => {
  vi.mocked(copyTextToClipboard).mockResolvedValue(false);
  render(
    <FileOperations
      root="/repo"
      target={null}
      action={null}
      onAction={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "复制相对路径" }));

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "浏览器阻止复制，请手动复制：.",
    ),
  );
  expect(copyTextToClipboard).toHaveBeenCalledWith(".");
});

test("workspace upload events only run for the current root and can be cancelled without an error", async () => {
  let capturedSignal: AbortSignal | null = null;
  vi.mocked(uploadWorkspaceFile).mockImplementation(
    (_root, _path, _file, _version, options) =>
      new Promise<{ path: string; version: string }>((_resolve, reject) => {
        capturedSignal = options?.signal ?? null;
        capturedSignal?.addEventListener("abort", () => {
          const error = new DOMException("cancelled", "AbortError");
          reject(error);
        });
        // This case exercises cancellation while the upload is pending. A
        // wall-clock completion races the DOM update on a busy test worker.
      }),
  );
  render(
    <FileOperations
      root="/repo"
      target={{ path: "/repo/src", isDir: true }}
      action={null}
      onAction={vi.fn()}
    />,
  );
  const skipped = new File(["skip"], "skip.txt");
  window.dispatchEvent(
    new CustomEvent("workspace-files-upload", {
      detail: { root: "/other", dir: "/other", files: [skipped] },
    }),
  );
  expect(uploadWorkspaceFile).not.toHaveBeenCalled();

  const uploaded = new File(["payload"], "upload.txt");
  window.dispatchEvent(
    new CustomEvent("workspace-files-upload", {
      detail: { root: "/repo", dir: "/repo/src", files: [uploaded] },
    }),
  );
  await waitFor(() => expect(capturedSignal).toBeTruthy());

  fireEvent.click(await screen.findByRole("button", { name: "取消上传" }));
  expect(vi.mocked(uploadWorkspaceFile).mock.calls[0][4]?.signal?.aborted).toBe(
    true,
  );

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "取消上传" })).toBeNull(),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(uploadWorkspaceFile).toHaveBeenCalledWith(
    "/repo",
    "/repo/src/upload.txt",
    uploaded,
    undefined,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("cancelling while an upload conflict is open stops the whole batch", async () => {
  vi.mocked(uploadWorkspaceFile).mockRejectedValueOnce(
    new Error("目标文件已存在，请选择跳过、改名或明确覆盖"),
  );
  render(
    <FileOperations
      root="/repo"
      target={{ path: "/repo/src", isDir: true }}
      action={null}
      onAction={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
  fireEvent.change(screen.getByLabelText("选择上传文件"), {
    target: {
      files: [
        new File(["first"], "first.txt"),
        new File(["second"], "second.txt"),
      ],
    },
  });

  await screen.findByText("上传目标已存在");
  fireEvent.click(screen.getByRole("button", { name: "取消上传" }));

  await waitFor(() => expect(uploadWorkspaceFile).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("relative copying normalizes a project root with a trailing slash", async () => {
  render(
    <FileOperations
      root="/repo/"
      target={{ path: "/repo/src/file.txt", isDir: false }}
      action={null}
      onAction={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制相对路径" }));
  await waitFor(() =>
    expect(copyTextToClipboard).toHaveBeenCalledWith("src/file.txt"),
  );
});
test("local relative paths use the visible directory rather than the filesystem root", async () => {
  render(
    <FileOperations
      root="/"
      displayRoot="/outside"
      target={{ path: "/outside/notes.txt", isDir: false }}
      action={null}
      onAction={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制相对路径" }));
  await waitFor(() =>
    expect(copyTextToClipboard).toHaveBeenCalledWith("notes.txt"),
  );
});
test("relative paths to a resolved sibling directory retain their relationship to the visible folder", async () => {
  render(
    <FileOperations
      root="/"
      displayRoot="/project"
      target={{ path: "/other/notes.txt", isDir: false }}
      action={null}
      onAction={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制相对路径" }));
  await waitFor(() =>
    expect(copyTextToClipboard).toHaveBeenCalledWith("../other/notes.txt"),
  );
});
