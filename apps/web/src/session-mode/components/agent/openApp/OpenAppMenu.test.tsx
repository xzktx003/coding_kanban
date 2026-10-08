import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { OpenAppMenu } from "./OpenAppMenu";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const api = vi.hoisted(() => ({ openProjectVsCodeWeb: vi.fn() }));
vi.mock("../../../../lib/api", () => api);
beforeEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState({
    isRightPanelOpen: false,
    activeRightPanelTab: "diff",
    openRightPanelTabs: ["diff"],
  });
});
test("opens VS Code in the existing right panel without a browser popup", () => {
  const popup = vi.spyOn(window, "open").mockReturnValue(null);
  render(<OpenAppMenu path="/project" />);
  fireEvent.click(screen.getByRole("button", { name: /VS Code/ }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("vscode");
  fireEvent.click(screen.getByRole("button", { name: /VS Code/ }));
  expect(
    useLayoutStore
      .getState()
      .openRightPanelTabs.filter((tab) => tab === "vscode"),
  ).toHaveLength(1);
  expect(popup).not.toHaveBeenCalled();
  popup.mockRestore();
  expect(screen.getByRole("button").querySelector("img")).toBeTruthy();
});
