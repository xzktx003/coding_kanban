import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CodexThreadManager } from "./CodexThreadManager";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  reload: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@session/services/apiAdapt", () => ({
  listThreads: api.list,
  deleteFile: api.remove,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreads: api.reload, setCurrentThread: api.select },
}));
vi.mock("@session/components/common/SessionManagerShared", () => ({
  Toolbar: ({ search, onSearch, onToggleAll, onDeleteSelected }: any) => (
    <>
      <input
        aria-label="搜索"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <button onClick={onToggleAll}>全选</button>
      <button onClick={onDeleteSelected}>请求删除</button>
    </>
  ),
  DeleteConfirmDialog: ({ open, onConfirm }: any) =>
    open ? <button onClick={onConfirm}>确认删除</button> : null,
}));
const rows = [
  {
    id: "ok",
    name: "中文新名称",
    preview: "old original",
    cwd: "/fixture",
    path: "/fixture/ok",
    createdAt: 1,
  },
  {
    id: "fail",
    name: "保留失败项",
    preview: "another original",
    cwd: "/fixture",
    path: "/fixture/fail",
    createdAt: 1,
  },
];
beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ data: rows, nextCursor: null });
  api.remove.mockReset();
  api.reload.mockResolvedValue(undefined);
  api.select.mockClear();
});
test("manager displays and searches the renamed title", async () => {
  render(<CodexThreadManager onClose={vi.fn()} />);
  await screen.findByText("中文新名称");
  fireEvent.change(screen.getByRole("textbox", { name: "搜索" }), {
    target: { value: "中文新名称" },
  });
  expect(screen.queryByText("保留失败项")).toBeNull();
  expect(screen.getByText("中文新名称")).toBeTruthy();
});
test("partial deletion keeps failed entries and selection available to retry", async () => {
  api.remove.mockImplementation((path: string) =>
    path.endsWith("/fail")
      ? Promise.reject(new Error("denied"))
      : Promise.resolve(),
  );
  render(<CodexThreadManager onClose={vi.fn()} />);
  await screen.findByText("中文新名称");
  fireEvent.click(screen.getByText("全选"));
  fireEvent.click(screen.getByText("请求删除"));
  fireEvent.click(screen.getByText("确认删除"));
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("中文新名称")).toBeNull());
  expect(screen.getByText(/保留失败项|another original/)).toBeTruthy();
  fireEvent.click(screen.getByText("请求删除"));
  fireEvent.click(screen.getByText("确认删除"));
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(3));
});
test("listing errors show retry instead of no results", async () => {
  api.list.mockRejectedValueOnce(new Error("network"));
  render(<CodexThreadManager onClose={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("network");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("中文新名称");
});
