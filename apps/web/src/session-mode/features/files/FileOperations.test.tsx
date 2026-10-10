import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { copyTextToClipboard } from "../../../lib/clipboard";
import { FileOperations } from "./FileOperations";
import {
  downloadWorkspaceFile,
  uploadWorkspaceFile,
  workspaceFileRequest,
} from "@session/services/workspaceFiles";

vi.mock("../../../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("@session/services/workspaceFiles", () => ({
  downloadWorkspaceFile: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
  workspaceFileRequest: vi.fn(),
}));

vi.mock("@session/stores/useEditorStore", () => ({
  useEditorStore: { getState: () => ({ openFile: vi.fn(), openFiles: [] }) },
}));

vi.mock("@session/stores/useFileDocumentStore", () => ({
  useFileDocumentStore: { getState: () => ({ move: vi.fn() }) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  vi.mocked(uploadWorkspaceFile).mockResolvedValue({
    path: "/repo/src/upload.txt",
    version: "v1",
  });
  vi.mocked(workspaceFileRequest).mockResolvedValue({ version: "v1" });
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
      new Promise<{ path: string; version: string }>((resolve, reject) => {
        capturedSignal = options?.signal ?? null;
        capturedSignal?.addEventListener("abort", () => {
          const error = new DOMException("cancelled", "AbortError");
          reject(error);
        });
        setTimeout(
          () => resolve({ path: "/repo/src/upload.txt", version: "v1" }),
          50,
        );
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

  fireEvent.click(screen.getByRole("button", { name: "取消上传" }));

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
