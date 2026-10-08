import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { DesktopToolDock } from "./DesktopToolDock";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const mock = vi.hoisted(() => ({
  mobile: false,
  path: "/project/current" as string | null,
}));
vi.mock("@session/hooks/use-mobile", () => ({
  useIsMobile: () => mock.mobile,
}));
vi.mock("@session/hooks/useActiveSessionProject", () => ({
  useActiveSessionProject: () => ({ path: mock.path, label: "current" }),
}));
const show = () =>
  render(<DesktopToolDock containerRef={createRef<HTMLDivElement>()} />);
beforeEach(() => {
  mock.mobile = false;
  mock.path = "/project/current";
  useLayoutStore.setState({
    view: "agent",
    isRightPanelOpen: false,
    isRightPanelFocused: false,
    activeRightPanelTab: null,
    openRightPanelTabs: [],
    terminals: [{ id: "keep", label: "keep" }],
    activeTerminalId: "keep",
  });
  useVsCodePanelStore.setState({ pinnedPath: null, hasOpened: true });
  useWorkspaceStore.setState({ cwd: "/wrong" });
});
it("always exposes five desktop controls and disables maximize while closed", () => {
  show();
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(
    screen.getByRole("button", { name: "放大工具区" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "文件浏览器" }));
  expect(useWorkspaceStore.getState().cwd).toBe("/project/current");
  expect(useLayoutStore.getState()).toMatchObject({
    activeRightPanelTab: "files",
    isRightPanelOpen: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "文件浏览器" }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
});
it("switches tools, hides/reopens the last one and preserves terminal resources", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "VS Code" }));
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("vscode");
  fireEvent.click(screen.getByRole("button", { name: "终端" }));
  const terminal = screen.getByRole("button", { name: "终端" });
  expect(terminal.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "放大工具区" }));
  expect(useLayoutStore.getState().isRightPanelFocused).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "还原工具区" }));
  expect(useLayoutStore.getState().isRightPanelFocused).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "收起右侧面板" }));
  expect(useLayoutStore.getState().terminals).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "展开右侧面板" }));
  expect(useLayoutStore.getState()).toMatchObject({
    isRightPanelOpen: true,
    activeRightPanelTab: "terminal",
  });
  expect(screen.getByRole("button", { name: "终端" })).toBe(terminal);
});
it("mobile keeps its menu and does not render the desktop dock", () => {
  mock.mobile = true;
  show();
  expect(screen.queryByRole("group")).toBeNull();
});
it("does not borrow an unrelated project; a pinned VS Code remains available", () => {
  mock.path = null;
  useVsCodePanelStore.setState({ pinnedPath: "/pinned" });
  show();
  expect(
    screen.getByRole("button", { name: "文件浏览器" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "VS Code" }).hasAttribute("disabled"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "VS Code" }));
  expect(useWorkspaceStore.getState().cwd).toBe("/wrong");
  expect(useVsCodePanelStore.getState().pinnedPath).toBe("/pinned");
});
