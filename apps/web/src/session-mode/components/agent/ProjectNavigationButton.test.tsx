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
it("names the current project and opens the desktop list without changing project or agent", () => {
  render(<ProjectNavigationButton />);
  const button = screen.getByRole("button", { name: "项目与会话" });
  expect(button.textContent).toBe("中文项目");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(sidebar.setOpen).toHaveBeenCalledWith(true);
  expect(useWorkspaceStore.getState().cwd).toBe("/work/中文项目");
  expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
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
