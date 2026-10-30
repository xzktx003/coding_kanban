import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { ThreadList } from "./ThreadList";

const fixture = vi.hoisted(() => ({
  list: vi.fn(),
  select: vi.fn(),
  remove: vi.fn(),
  titleRenders: new Map<string, number>(),
}));
vi.mock("@session/services/apiAdapt", () => ({
  listThreads: fixture.list,
  deleteThread: fixture.remove,
  archiveThread: vi.fn(),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: fixture.select, threadFork: vi.fn() },
}));
vi.mock("../../common/SessionRowTitle", () => ({
  SessionRowTitle: ({ title }: { title: string }) => {
    fixture.titleRenders.set(title, (fixture.titleRenders.get(title) ?? 0) + 1);
    return <span>{title}</span>;
  },
}));
vi.mock("@session/components/codex/thread/RenameThreadDialog", () => ({
  RenameThreadDialog: () => null,
}));

const rows = Array.from({ length: 40 }, (_, index) => ({
  id: `sidebar-${index}`,
  name: `Sidebar row ${index}`,
  preview: `preview ${index}`,
  cwd: "/sidebar-fixture",
  createdAt: 1,
  updatedAt: 1,
  modelProvider: "openai",
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.titleRenders.clear();
  fixture.list.mockResolvedValue({ data: rows, nextCursor: null });
  fixture.remove.mockResolvedValue(undefined);
  fixture.select.mockImplementation(async (id: string | null) => {
    useCodexStore.setState({ currentThreadId: id });
  });
  useCodexStore.setState({
    threads: [],
    currentThreadId: "external-a",
    threadStatusMap: {},
  });
  useAgentCenterStore.setState({ cards: [], currentAgentCardId: null });
  useWorkspaceStore.setState({ cwd: "/sidebar-fixture" });
  useLayoutStore.setState({ view: "agent" });
});
async function mounted() {
  const view = render(<ThreadList cwd="/sidebar-fixture" />);
  await screen.findByText("Sidebar row 39");
  await waitFor(() =>
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull(),
  );
  return view;
}

test("switching external threads and attention/layout selection does not rebuild sidebar rows", async () => {
  const view = await mounted();
  const before = new Map(fixture.titleRenders);
  await act(async () => {
    useCodexStore.setState({ currentThreadId: "external-b" });
    useAgentCenterStore.setState({ currentAgentCardId: "external-b" });
    useLayoutStore.setState({ isRightPanelFocused: true });
  });
  view.rerender(<ThreadList cwd="/sidebar-fixture" />);
  expect(fixture.titleRenders).toEqual(before);
  expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(
    0,
  );
  expect(fixture.list).toHaveBeenCalledTimes(1);
  expect(fixture.select).not.toHaveBeenCalled();
});

test("selection updates the old and new rows without rebuilding unrelated titles", async () => {
  const view = await mounted();
  await act(async () =>
    useCodexStore.setState({ currentThreadId: "sidebar-0" }),
  );
  const first = screen.getByRole("button", { name: /Sidebar row 0 / });
  expect(first.getAttribute("aria-current")).toBe("true");
  const before = new Map(fixture.titleRenders);
  await act(async () =>
    useCodexStore.setState({ currentThreadId: "sidebar-1" }),
  );
  expect(first.getAttribute("aria-current")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: /Sidebar row 1 / })
      .getAttribute("aria-current"),
  ).toBe("true");
  for (const row of rows.slice(2))
    expect(fixture.titleRenders.get(row.name)).toBe(before.get(row.name));
  expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(
    1,
  );
});

test("a thread status change still reaches its indicator without rebuilding row titles", async () => {
  await mounted();
  const before = new Map(fixture.titleRenders);
  const row = screen.getByRole("button", { name: /Sidebar row 2 / });
  await act(async () =>
    useCodexStore.setState({
      threadStatusMap: { "sidebar-2": { type: "active", activeFlags: [] } },
    }),
  );
  await waitFor(() =>
    expect(row.querySelector('[data-state="running"]')).toBeTruthy(),
  );
  expect(fixture.titleRenders).toEqual(before);
});

test.each([
  { initial: "sidebar-0", selectedAfter: "sidebar-1", closesCurrent: false },
  { initial: "sidebar-1", selectedAfter: "sidebar-0", closesCurrent: true },
])(
  "a pending deletion closes only the current target at its receipt: $selectedAfter",
  async ({ initial, selectedAfter, closesCurrent }) => {
    let finish!: () => void;
    fixture.remove.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => useCodexStore.setState({ currentThreadId: initial }));
    await mounted();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Sidebar row 0 / }),
      { clientX: 10, clientY: 10 },
    );
    fireEvent.click(await screen.findByText("删除", { exact: true }));
    expect(
      screen
        .getByRole("alertdialog")
        .textContent?.includes("当前会话视图也会关闭"),
    ).toBe(initial === "sidebar-0");
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    await waitFor(() =>
      expect(fixture.remove).toHaveBeenCalledExactlyOnceWith("sidebar-0"),
    );
    await act(async () =>
      useCodexStore.setState({ currentThreadId: selectedAfter }),
    );
    expect(
      screen
        .getByRole("alertdialog")
        .textContent?.includes("当前会话视图也会关闭"),
    ).toBe(closesCurrent);
    fixture.list.mockResolvedValue({ data: rows.slice(1), nextCursor: null });
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(useCodexStore.getState().currentThreadId).toBe(
      closesCurrent ? null : selectedAfter,
    );
    if (closesCurrent)
      expect(fixture.select).toHaveBeenCalledExactlyOnceWith(null);
    else expect(fixture.select).not.toHaveBeenCalled();
  },
);
