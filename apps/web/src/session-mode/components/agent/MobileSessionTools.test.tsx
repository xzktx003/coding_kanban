import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const sidebar = vi.hoisted(() => ({
  setOpenMobile: vi.fn(),
  isMobile: true,
  openMobile: false,
}));
vi.mock("../ui/sidebar", () => ({ useSidebar: () => sidebar }));
vi.mock("./openApp/OpenAppMenu", () => ({ OpenAppMenu: () => null }));
import { MobileProjectButton } from "./MobileSessionTools";

it("offers a visible project entry without first opening the tools menu", () => {
  render(<MobileProjectButton />);
  const project = screen.getByRole("button", { name: "项目与会话" });
  expect(project.textContent).toContain("项目");
  fireEvent.click(project);
  expect(sidebar.setOpenMobile).toHaveBeenCalledWith(true);
  expect(screen.queryByRole("menu")).toBeNull();
});
