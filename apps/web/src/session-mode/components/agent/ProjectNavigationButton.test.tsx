import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
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
