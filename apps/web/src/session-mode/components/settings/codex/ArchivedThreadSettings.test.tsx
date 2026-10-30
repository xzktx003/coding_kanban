import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ArchivedThreadSettings } from "./ArchivedThreadSettings";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
const api = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  listThreads: api.list,
  unarchiveThread: api.restore,
}));
vi.mock("@session/services/apiAdapt", () => ({
  listThreads: api.list,
  unarchiveThread: api.restore,
}));
const row = (id: string) => ({
  id,
  name: `归档 ${id}`,
  preview: `preview ${id}`,
  cwd: "/fixture",
  createdAt: 1,
  updatedAt: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue({ data: [], nextCursor: null });
  api.restore.mockResolvedValue({ restored: true });
});
it("loads genuine archived continuation pages, de-duplicates IDs and exposes Chinese retry copy", async () => {
  api.list
    .mockResolvedValueOnce({ data: [row("one")], nextCursor: "second" })
    .mockRejectedValueOnce(new Error("分页暂时失败"))
    .mockResolvedValueOnce({
      data: [row("one"), row("two")],
      nextCursor: null,
    });
  render(
    <div className="session-mode">
      <ArchivedThreadSettings />
    </div>,
  );
  await screen.findByText("归档 one");
  fireEvent.click(screen.getByRole("button", { name: "加载更多归档聊天" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "分页暂时失败",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试加载归档聊天" }));
  await screen.findByText("归档 two");
  expect(screen.getAllByText("归档 one")).toHaveLength(1);
  expect(api.list.mock.calls[1][0].cursor).toBe("second");
  expect(api.list.mock.calls[2][0].cursor).toBe("second");
  expect(screen.queryByRole("button", { name: "加载更多归档聊天" })).toBeNull();
});
it("one failed restore never brings back a different successfully restored row", async () => {
  api.list.mockResolvedValue({
    data: [row("one"), row("two")],
    nextCursor: null,
  });
  let rejectFirst!: (error: Error) => void;
  api.restore.mockImplementation((id: string) =>
    id === "one"
      ? new Promise((_resolve, reject) => {
          rejectFirst = reject;
        })
      : Promise.resolve({ restored: true }),
  );
  render(
    <div className="session-mode">
      <ArchivedThreadSettings />
    </div>,
  );
  await screen.findByText("归档 one");
  fireEvent.click(screen.getByRole("button", { name: "恢复聊天：归档 one" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复聊天：归档 two" }));
  await waitFor(() => expect(screen.queryByText("归档 two")).toBeNull());
  await act(async () => {
    rejectFirst(new Error("原会话恢复失败"));
  });
  await screen.findByText("归档 one");
  expect(screen.queryByText("归档 two")).toBeNull();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "原会话恢复失败",
  );
});
it("account replacement rejects late old archive pages and starts a fresh scoped listing", async () => {
  let release!: (value: any) => void;
  api.list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue({ data: [row("new-account")], nextCursor: null });
  const view = render(
    <div className="session-mode">
      <ArchivedThreadSettings />
    </div>,
  );
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
  await act(async () => {
    useCodexStore.setState({ accountNamespace: "archive-new-account" });
  });
  await screen.findByText("归档 new-account");
  await act(async () => {
    release({ data: [row("old-account")], nextCursor: null });
  });
  expect(screen.queryByText("归档 old-account")).toBeNull();
  view.unmount();
});
