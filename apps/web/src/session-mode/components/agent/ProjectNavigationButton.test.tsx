import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const sidebar = vi.hoisted(() => ({
  isMobile: false,
  open: false,
  openMobile: false,
  setOpen: vi.fn(),
  setOpenMobile: vi.fn(),
}));
vi.mock("../ui/sidebar", () => ({ useSidebar: () => sidebar }));
import { ProjectNavigationButton } from "./ProjectNavigationButton";
beforeEach(() => {
  sidebar.isMobile = false;
  sidebar.open = false;
  sidebar.openMobile = false;
  vi.clearAllMocks();
  useLayoutStore.setState({isSidebarOpen:false,view:"agent"});
  useWorkspaceStore.setState({ cwd: "/work/中文项目" });
});
it("separates the project breadcrumb from the desktop sidebar control", () => {
  render(<ProjectNavigationButton />);
  const button = screen.getByRole("button", { name: "展开项目列表" });
  const name = screen.getByText("中文项目");
  expect(name.closest("button")).not.toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(sidebar.setOpen).toHaveBeenCalledWith(true);
  expect(useWorkspaceStore.getState().cwd).toBe("/work/中文项目");
  expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
});
it("opens a project menu without changing the selected project", async () => {
  sidebar.open = true;
  render(<ProjectNavigationButton />);
  expect(screen.getByText("中文项目").closest("button")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "展开项目列表" })).toBeNull();
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "项目：中文项目" }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "在列表中定位当前项目" }),
  );
  expect(sidebar.setOpen).toHaveBeenCalledWith(true);
  expect(useWorkspaceStore.getState().cwd).toBe("/work/中文项目");
});
it("uses the same control to open the phone drawer, with a compact label", () => {
  sidebar.isMobile = true;
  render(<ProjectNavigationButton compact />);
  const button = screen.getByRole("button", { name: "项目与会话" });
  expect(button.textContent).toBe("项目");
  fireEvent.click(button);
  expect(sidebar.setOpenMobile).toHaveBeenCalledWith(true);
  expect(sidebar.setOpen).not.toHaveBeenCalled();
});

it("opens the shared global entry without exposing a standalone project title", () => {
  const open = vi.fn();
  window.addEventListener("session-open-projects", open);
  render(<ProjectNavigationButton global />);
  fireEvent.click(screen.getByRole("button", { name: "展开项目列表" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("中文项目")).toBeNull();
  expect(useWorkspaceStore.getState().cwd).toBe("/work/中文项目");
  window.removeEventListener("session-open-projects", open);
});

it("uses the same fixed global button to collapse and expand the sidebar", () => {
  useLayoutStore.setState({isSidebarOpen:true,view:"agent"});
  const open = vi.fn();
  window.addEventListener("session-open-projects",open);
  render(<ProjectNavigationButton global />);
  const button = screen.getByRole("button",{name:"收起项目列表"});
  expect(button.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(button);
  expect(useLayoutStore.getState().isSidebarOpen).toBe(false);
  expect(useLayoutStore.getState().view).toBe("agent");
  expect(screen.getByRole("button",{name:"展开项目列表"})).toBe(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(open).toHaveBeenCalledTimes(1);
  window.removeEventListener("session-open-projects",open);
});
it("offers opening the projects from a secondary page even if the hidden sidebar is expanded", () => {
  useLayoutStore.setState({isSidebarOpen:true,view:"settings"});
  render(<ProjectNavigationButton global />);
  expect(screen.getByRole("button",{name:"展开项目列表"}).getAttribute("aria-expanded")).toBe("false");
});
