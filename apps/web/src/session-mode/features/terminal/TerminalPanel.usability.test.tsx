import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";
import { useLayoutStore } from "@session/stores/useLayoutStore";
vi.mock("@session/stores", async () => ({
  useLayoutStore: (await import("@session/stores/useLayoutStore"))
    .useLayoutStore,
}));
vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ active }: { active: boolean }) => (
    <input aria-label="隔离终端" hidden={!active} />
  ),
}));
beforeEach(() =>
  useLayoutStore.setState({
    terminals: [
      { id: "test-a", label: "中文终端" },
      { id: "test-b", label: "中文长名称终端" },
    ],
    activeTerminalId: "test-a",
    isRightPanelOpen: true,
  }),
);
test("native terminal selector and close have separate semantics", () => {
  render(<TerminalPanel isActive />);
  const selected = screen.getByRole("button", { name: "切换到终端 中文终端" });
  expect(selected.tagName).toBe("BUTTON");
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  const close = screen.getByRole("button", {
    name: "关闭终端 中文长名称终端（结束该终端进程）",
  });
  expect(close.parentElement?.closest("button")).toBeNull();
  fireEvent.click(close);
  expect(useLayoutStore.getState().activeTerminalId).toBe("test-a");
});
test("switch and hide preserve every terminal pane DOM", () => {
  render(<TerminalPanel isActive />);
  const panes = screen.getAllByLabelText("隔离终端");
  act(() => useLayoutStore.getState().setActiveTerminalId("test-b"));
  act(() => useLayoutStore.setState({ isRightPanelOpen: false }));
  expect(screen.getAllByLabelText("隔离终端")).toEqual(panes);
  expect(
    screen
      .getByRole("button", { name: "切换到终端 中文长名称终端" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
test("after explicitly closing the last terminal, show an empty state without creating another", () => {
  render(<TerminalPanel isActive />);
  act(() => {
    useLayoutStore.getState().removeTerminal("test-a");
    useLayoutStore.getState().removeTerminal("test-b");
  });
  expect(screen.getByText("暂无终端")).toBeTruthy();
  expect(useLayoutStore.getState().terminals).toEqual([]);
  expect(screen.getByRole("button", { name: "新建终端" })).toBeTruthy();
});

test("first open creates only one terminal under StrictMode effect replay", () => {
  useLayoutStore.setState({terminals: [], activeTerminalId: null});
  render(<StrictMode><TerminalPanel isActive /></StrictMode>);
  expect(useLayoutStore.getState().terminals).toHaveLength(1);
});
