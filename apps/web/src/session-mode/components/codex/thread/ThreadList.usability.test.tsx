import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ThreadList } from "./ThreadList";
import { useSessionNameStore } from "../../../stores/useSessionNameStore";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  select: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  fork: vi.fn(),
  pin: vi.fn(),
}));
vi.mock("@session/services/sessionManagementClient", () => ({
  setSharedSessionPin: api.pin,
}));
vi.mock("@session/services/apiAdapt", () => ({
  listThreads: api.list,
  archiveThread: api.archive,
  deleteThread: api.remove,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: api.select, threadFork: api.fork },
}));
vi.mock("@session/components/codex/thread/RenameThreadDialog", () => ({
  RenameThreadDialog: () => null,
}));
vi.mock("../../common/RenameSessionButton", () => ({
  RenameSessionButton: () => <button>改名</button>,
}));
const row = {
  id: "keyboard-codex",
  name: "中文任务",
  preview: "Original",
  cwd: "/fixture",
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ data: [row], nextCursor: null });
  api.select.mockClear();
  api.pin.mockReset();
  api.pin.mockResolvedValue({
    namespace: "fixture",
    kind: "codex",
    id: "keyboard-codex",
    revision: 1,
    value: true,
  });
});
test("Codex row keyboard opens only its own target", async () => {
  render(<ThreadList cwd="/fixture" />);
  const target = await screen.findByRole("button", { name: /中文任务/ });
  fireEvent.keyDown(target, { key: "Enter" });
  fireEvent.keyDown(target, { key: " " });
  expect(api.select).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByRole("button", { name: "会话操作" }), {
    key: "Enter",
  });
  expect(api.select).toHaveBeenCalledTimes(2);
});
test("native list names are preserved separately from a newly followed card's message preview", async () => {
  useSessionNameStore.setState({ names: {}, sources: {}, editRevisions: {} });
  render(<ThreadList cwd="/fixture" />);
  fireEvent.keyDown(await screen.findByRole("button", { name: /中文任务/ }), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(useSessionNameStore.getState().names["codex:keyboard-codex"]).toBe(
      "中文任务",
    ),
  );
});
test("the Codex list exposes Chinese management actions", async () => {
  render(<ThreadList cwd="/fixture" />);
  fireEvent.contextMenu(
    await screen.findByRole("button", { name: /中文任务/ }),
    { clientX: 10, clientY: 10 },
  );
  for (const name of [
    "重命名",
    "置顶",
    "分叉聊天",
    "归档",
    "删除",
    "复制会话 ID",
  ])
    expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
});

const touchPointer = (target: Element, type: string) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    clientX: { value: 20 },
    clientY: { value: 30 },
  });
  fireEvent(target, event);
};

test("a touch hold opens the exact row menu at 450ms and suppresses its release click", async () => {
  render(<ThreadList cwd="/fixture" />);
  const target = await screen.findByRole("button", { name: /中文任务/ });
  const contextMenu = vi.fn();
  target.addEventListener("contextmenu", contextMenu);
  vi.useFakeTimers();
  try {
    touchPointer(target, "pointerdown");
    act(() => vi.advanceTimersByTime(449));
    expect(contextMenu).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(contextMenu).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeTruthy();
    touchPointer(target, "pointerup");
    fireEvent.click(target);
    expect(api.select).not.toHaveBeenCalled();
    expect(api.archive).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test.each(["pointerup", "pointermove", "pointercancel"])("a %s before the hold threshold cancels the menu", async (type) => {
  render(<ThreadList cwd="/fixture" />);
  const target = await screen.findByRole("button", { name: /中文任务/ });
  const contextMenu = vi.fn();
  target.addEventListener("contextmenu", contextMenu);
  vi.useFakeTimers();
  try {
    touchPointer(target, "pointerdown");
    act(() => vi.advanceTimersByTime(449));
    touchPointer(target, type);
    act(() => vi.advanceTimersByTime(500));
    expect(contextMenu).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull();
    expect(api.select).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
test("list pinning waits for the shared management transaction rather than changing only a local store", async () => {
  render(<ThreadList cwd="/fixture" />);
  fireEvent.contextMenu(
    await screen.findByRole("button", { name: /中文任务/ }),
    { clientX: 10, clientY: 10 },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "置顶" }));
  await waitFor(() =>
    expect(api.pin).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "codex", id: "keyboard-codex" }),
      true,
    ),
  );
});
test("failed Codex listing has retry rather than empty history", async () => {
  api.list.mockRejectedValueOnce(new Error("offline"));
  render(<ThreadList cwd="/fixture" />);
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  expect(screen.queryByText("该项目还没有会话。")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.getByText("中文任务")).toBeTruthy());
});
test("Codex deletion requires confirmation", async () => {
  render(<ThreadList cwd="/fixture" />);
  const target = await screen.findByRole("button", { name: /中文任务/ });
  fireEvent.contextMenu(target, { clientX: 10, clientY: 10 });
  fireEvent.click(await screen.findByText("删除", { exact: true }));
  expect(api.remove).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledWith("keyboard-codex"),
  );
});
test("failed next page offers retry instead of a dead error line", async () => {
  api.list.mockReset();
  api.list
    .mockResolvedValueOnce({ data: [row], nextCursor: "page-2" })
    .mockRejectedValueOnce(new Error("page offline"))
    .mockResolvedValueOnce({
      data: [{ ...row, id: "page-row", name: "第二页" }],
      nextCursor: null,
    });
  render(<ThreadList cwd="/fixture" />);
  await screen.findByText("中文任务");
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "page offline",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.getByText("第二页")).toBeTruthy());
});
test("late pagination cannot insert rows from a previous project", async () => {
  let resolveOld!: (value: any) => void;
  api.list.mockReset();
  api.list
    .mockResolvedValueOnce({ data: [row], nextCursor: "page-2" })
    .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
    .mockResolvedValueOnce({
      data: [{ ...row, id: "new-project", name: "新项目会话", cwd: "/new" }],
      nextCursor: null,
    });
  const { rerender } = render(<ThreadList cwd="/fixture" />);
  await screen.findByText("中文任务");
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  rerender(<ThreadList cwd="/new" />);
  await screen.findByText("新项目会话");
  resolveOld({
    data: [{ ...row, id: "old-page", name: "过期页" }],
    nextCursor: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.queryByText("过期页")).toBeNull();
});

test("fork opens the API returned identity and preserves the source card", async () => {
  const { useAgentCenterStore } =
    await import("@session/stores/useAgentCenterStore");
  useAgentCenterStore.setState({
    cards: [
      {
        kind: "codex",
        id: "keyboard-codex",
        preview: "source",
        cwd: "/fixture",
      },
    ],
    currentAgentCardId: "keyboard-codex",
  });
  const { useCodexStore } = await import("@session/components/codex/stores");
  useCodexStore.setState({ currentThreadId: "keyboard-codex" });
  api.fork.mockImplementation(async () => {
    useCodexStore.setState({ currentThreadId: "new-fork" });
    return {
      id: "new-fork",
      name: "Fork title",
      preview: "forked",
      cwd: "/fixture",
    };
  });
  render(<ThreadList cwd="/fixture" />);
  fireEvent.contextMenu(
    await screen.findByRole("button", { name: /中文任务/ }),
    { clientX: 10, clientY: 10 },
  );
  fireEvent.click(await screen.findByText("分叉聊天", { exact: true }));
  await waitFor(() =>
    expect(useAgentCenterStore.getState().currentAgentCardId).toBe("new-fork"),
  );
  expect(
    useAgentCenterStore
      .getState()
      .cards.map((card) => card.id)
      .sort(),
  ).toEqual(["keyboard-codex", "new-fork"]);
  expect(useCodexStore.getState().currentThreadId).toBe("new-fork");
  expect(api.select).not.toHaveBeenCalledWith("keyboard-codex");
});

test("successful archive removes navigation cache without altering history or live task", async () => {
  const { useCodexStore } = await import("@session/components/codex/stores");
  const history = [
    { method: "fixture/history", params: { threadId: "keyboard-codex" } },
  ];
  useCodexStore.setState({
    threads: [{ ...row, modelProvider: "openai" }] as any,
    currentThreadId: "keyboard-codex",
    events: { "keyboard-codex": history } as any,
    activeThreadIds: ["keyboard-codex"],
  });
  render(<ThreadList cwd="/fixture" />);
  await screen.findByText("中文任务");
  api.list.mockResolvedValue({ data: [], nextCursor: null });
  fireEvent.pointerDown(screen.getByRole("button", { name: "会话操作" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "归档" }));
  await waitFor(() => expect(screen.queryByText("中文任务")).toBeNull());
  expect(
    useCodexStore
      .getState()
      .threads.find((thread) => thread.id === "keyboard-codex"),
  ).toBeUndefined();
  expect(useCodexStore.getState().currentThreadId).toBe("keyboard-codex");
  expect(useCodexStore.getState().activeThreadIds).toContain("keyboard-codex");
  expect(useCodexStore.getState().events["keyboard-codex"]).toBe(history);
});

test("successful deletion updates navigation while preserving unrelated execution and cached transcript", async () => {
  const { useCodexStore } = await import("@session/components/codex/stores");
  const history = [
    { method: "fixture/history", params: { threadId: "keyboard-codex" } },
  ];
  useCodexStore.setState({
    threads: [{ ...row, modelProvider: "openai" }] as any,
    currentThreadId: "another-task",
    events: { "keyboard-codex": history } as any,
    activeThreadIds: ["another-task"],
  });
  render(<ThreadList cwd="/fixture" />);
  fireEvent.contextMenu(
    await screen.findByRole("button", { name: /中文任务/ }),
    { clientX: 10, clientY: 10 },
  );
  fireEvent.click(await screen.findByText("删除", { exact: true }));
  api.list.mockResolvedValue({ data: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
  await waitFor(() => expect(screen.queryByText("中文任务")).toBeNull());
  expect(
    useCodexStore
      .getState()
      .threads.find((thread) => thread.id === "keyboard-codex"),
  ).toBeUndefined();
  expect(useCodexStore.getState().currentThreadId).toBe("another-task");
  expect(useCodexStore.getState().activeThreadIds).toEqual(["another-task"]);
  expect(useCodexStore.getState().events["keyboard-codex"]).toBe(history);
});
