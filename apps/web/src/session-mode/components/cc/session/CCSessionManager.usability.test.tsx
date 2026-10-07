import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CCSessionManager } from "./CCSessionManager";
const api = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock("@session/lib/sessions", () => ({ listSessions: api.list }));
vi.mock("@session/services/apiAdapt/cc", () => ({
  ccDeleteSession: api.remove,
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
  { session_id: "ok", summary: "成功项", cwd: "/fixture", last_modified: 1 },
  { session_id: "fail", summary: "失败项", cwd: "/fixture", last_modified: 1 },
];
beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ sessions: rows, total: 2 });
  api.remove.mockReset();
});
test("Claude partial deletion keeps failed entries selected for retry", async () => {
  api.remove.mockImplementation((id: string) =>
    id === "fail" ? Promise.reject(new Error("denied")) : Promise.resolve(),
  );
  render(<CCSessionManager open onClose={vi.fn()} />);
  await screen.findByText("成功项");
  fireEvent.click(screen.getByText("全选"));
  fireEvent.click(screen.getByText("请求删除"));
  fireEvent.click(screen.getByText("确认删除"));
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("成功项")).toBeNull());
  expect(screen.getByText("失败项")).toBeTruthy();
  fireEvent.click(screen.getByText("请求删除"));
  fireEvent.click(screen.getByText("确认删除"));
  await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(3));
});
test("Claude checkbox keyboard does not open its session", async () => {
  const close = vi.fn();
  render(<CCSessionManager open onClose={close} />);
  await screen.findByText("成功项");
  fireEvent.keyDown(screen.getAllByRole("checkbox")[0], { key: " " });
  expect(close).not.toHaveBeenCalled();
});
test("Claude list failure has explicit retry", async () => {
  api.list.mockRejectedValueOnce(new Error("offline"));
  render(<CCSessionManager open onClose={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("成功项");
});
