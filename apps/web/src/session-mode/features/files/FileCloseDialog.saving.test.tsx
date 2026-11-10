import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileCloseDialog } from "./FileCloseDialog";
import {
  persistFileDraft,
  saveWorkspaceText,
} from "@session/services/workspaceFiles";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { useFileSaveStatusStore } from "@session/stores/useFileSaveStatusStore";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: api.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  authHeaders: () => ({}),
  buildUrl: (path: string) => path,
  buildEventUrl: (path: string) => path,
}));

const path = "/fixture/a.ts";
function deferredSave() {
  let resolve!: (value: { path: string; version: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ path: string; version: string }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  api.post.mockReset();
  useFileSaveStatusStore.setState({ pending: new Map(), failures: new Map() });
  useFileDocumentStore.setState({ documents: {} });
  useFileDocumentStore.getState().load(path, "/fixture", "原始内容", "v1");
  useFileDocumentStore.getState().edit(path, "待保存草稿");
});

test("an in-flight save blocks a second write for the same file", async () => {
  const pending = deferredSave();
  api.post
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ path, version: "unexpected" });
  const first = saveWorkspaceText("/fixture", path, "待保存草稿", "v1");
  try {
    await expect(
      saveWorkspaceText("/fixture", path, "重复提交", "v1"),
    ).rejects.toThrow("正在保存");
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(useFileSaveStatusStore.getState().failures.has(path)).toBe(false);
  } finally {
    pending.resolve({ path, version: "v2" });
    await first;
  }
});

test("a save for another file can proceed while the first file is pending", async () => {
  const pending = deferredSave();
  api.post
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ path: "/fixture/b.ts", version: "b2" });
  const first = saveWorkspaceText("/fixture", path, "待保存草稿", "v1");
  try {
    await expect(
      saveWorkspaceText("/fixture", "/fixture/b.ts", "另一个文件", "b1"),
    ).resolves.toMatchObject({ version: "b2" });
    expect(useFileSaveStatusStore.getState().pending.has(path)).toBe(true);
    expect(useFileSaveStatusStore.getState().pending.has("/fixture/b.ts")).toBe(
      false,
    );
  } finally {
    pending.resolve({ path, version: "v2" });
    await first;
  }
});

test("a revert made during an unconfirmed save survives rehydration and a changed disk", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const inFlight = persistFileDraft(path).catch(() => {});
  try {
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    useFileDocumentStore.getState().edit(path, "原始内容");
    const persisted = localStorage.getItem("kanban.session.file-drafts")!;
    expect(JSON.parse(persisted).state.documents[path]).toMatchObject({
      draft: "原始内容",
      base: "原始内容",
      saveUnconfirmed: true,
    });
    useFileDocumentStore.setState({ documents: {} });
    localStorage.setItem("kanban.session.file-drafts", persisted);
    await useFileDocumentStore.persist.rehydrate();
    useFileDocumentStore.getState().load(path, "/fixture", "待保存草稿", "v2");
    expect(useFileDocumentStore.getState().documents[path]).toMatchObject({
      draft: "原始内容",
      base: "原始内容",
      version: "v1",
      diskChanged: true,
      saveUnconfirmed: true,
    });
  } finally {
    pending.reject(new Error("连接已断开"));
    await inFlight;
  }
});

test("a malformed save receipt cannot mark a draft as saved", async () => {
  api.post.mockResolvedValueOnce({ path });
  await expect(persistFileDraft(path)).rejects.toThrow("保存结果无法确认");
  expect(useFileDocumentStore.getState().documents[path]).toMatchObject({
    base: "原始内容",
    draft: "待保存草稿",
    version: "v1",
  });
  expect(useFileSaveStatusStore.getState().failures.get(path)).toContain(
    "保存结果无法确认",
  );
});

test("a confirmed save clears the recovery marker without retaining a clean document", async () => {
  api.post.mockResolvedValueOnce({ path, version: "v2" });
  await persistFileDraft(path);
  expect(useFileDocumentStore.getState().documents[path]).toMatchObject({
    base: "待保存草稿",
    draft: "待保存草稿",
    version: "v2",
    saveUnconfirmed: false,
  });
  expect(
    JSON.parse(localStorage.getItem("kanban.session.file-drafts")!).state
      .documents[path],
  ).toBeUndefined();
});

test("a receipt for another file cannot mark the current draft as saved", async () => {
  api.post.mockResolvedValueOnce({ path: "/fixture/b.ts", version: "v2" });
  await expect(persistFileDraft(path)).rejects.toThrow("保存结果无法确认");
  expect(useFileDocumentStore.getState().documents[path]).toMatchObject({
    base: "原始内容",
    draft: "待保存草稿",
    version: "v1",
  });
});

test("a normalized receipt for the same absolute path is accepted", async () => {
  api.post.mockResolvedValueOnce({ path, version: "v2" });
  await expect(
    saveWorkspaceText("/fixture", "/fixture//./a.ts", "内容", "v1"),
  ).resolves.toMatchObject({ path, version: "v2" });
});

test("a save failure with no error message is still visible", async () => {
  api.post.mockRejectedValueOnce(new Error(""));
  await expect(persistFileDraft(path)).rejects.toThrow();
  expect(useFileSaveStatusStore.getState().failures.get(path)).toBe("未知错误");
});

test("closing a file while its save is pending cannot discard or resend the draft", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const first = saveWorkspaceText("/fixture", path, "待保存草稿", "v1");
  const onCancel = vi.fn(),
    onClose = vi.fn();
  try {
    render(
      <FileCloseDialog path={path} onCancel={onCancel} onClose={onClose} />,
    );
    expect(screen.getByRole("status").textContent).toContain("正在保存");
    expect(
      (screen.getByRole("button", { name: "放弃修改" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "保存并关闭" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(useFileDocumentStore.getState().documents[path].draft).toBe(
      "待保存草稿",
    );
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      pending.resolve({ path, version: "v2" });
      await first;
    });
  }
});

test("leaving a pending save-and-close keeps later edits and never closes the file on a late receipt", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const onCancel = vi.fn(),
    onClose = vi.fn();
  render(<FileCloseDialog path={path} onCancel={onCancel} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(onCancel).toHaveBeenCalledOnce();
  act(() => useFileDocumentStore.getState().edit(path, "保存过程中继续输入"));
  await act(async () => pending.resolve({ path, version: "v2" }));
  await waitFor(() =>
    expect(useFileDocumentStore.getState().documents[path]).toMatchObject({
      base: "待保存草稿",
      draft: "保存过程中继续输入",
      version: "v2",
    }),
  );
  expect(onClose).not.toHaveBeenCalled();
});

test("a confirmed save with newer edits asks to save them without claiming the first save is unknown", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const onClose = vi.fn();
  render(<FileCloseDialog path={path} onCancel={vi.fn()} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  act(() => useFileDocumentStore.getState().edit(path, "新的草稿"));
  await act(async () => pending.resolve({ path, version: "v2" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "保存期间又有新修改",
    ),
  );
  expect(screen.getByRole("alert").textContent).not.toContain("保存未确认");
  expect(onClose).not.toHaveBeenCalled();
});

test("a detached save failure remains visible for its file without closing it", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const onCancel = vi.fn(),
    onClose = vi.fn();
  render(<FileCloseDialog path={path} onCancel={onCancel} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  await act(async () => pending.reject(new Error("连接中断")));
  await waitFor(() =>
    expect(useFileSaveStatusStore.getState().failures.get(path)).toBe(
      "连接中断",
    ),
  );
  expect(useFileDocumentStore.getState().documents[path].draft).toBe(
    "待保存草稿",
  );
  expect(onClose).not.toHaveBeenCalled();
});

test("after a pending save completes, a clean file can be closed without writing again", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const first = saveWorkspaceText("/fixture", path, "待保存草稿", "v1");
  const onClose = vi.fn();
  render(<FileCloseDialog path={path} onCancel={vi.fn()} onClose={onClose} />);
  await act(async () => {
    pending.resolve({ path, version: "v2" });
    await first;
    useFileDocumentStore.getState().saved(path, "待保存草稿", "v2");
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭文件" }));
  expect(onClose).toHaveBeenCalledWith(path);
  expect(api.post).toHaveBeenCalledTimes(1);
});

test("a late save-and-close receipt for A cannot close a newer B dialog", async () => {
  const pending = deferredSave();
  api.post.mockReturnValueOnce(pending.promise);
  const onCancel = vi.fn(),
    onClose = vi.fn();
  const view = render(
    <FileCloseDialog path={path} onCancel={onCancel} onClose={onClose} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  view.rerender(
    <FileCloseDialog
      path="/fixture/b.ts"
      onCancel={onCancel}
      onClose={onClose}
    />,
  );
  await act(async () => pending.resolve({ path, version: "v2" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").textContent).toContain("/fixture/b.ts");
});
