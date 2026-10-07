import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RightPanelHeader } from "./RightPanelHeader";
import { useLayoutStore } from "@session/stores/useLayoutStore";
vi.mock("@session/hooks", () => ({
  useTrafficLightConfig: () => ({ needsTrafficLightOffset: false }),
}));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@session/components/common/NewAgentButton", () => ({
  NewAgentButton: () => null,
}));
vi.mock("@session/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));
vi.mock("@session/stores", async () => ({
  useLayoutStore: (await import("@session/stores/useLayoutStore"))
    .useLayoutStore,
}));
beforeEach(() => {
  useLayoutStore.setState({
    openRightPanelTabs: ["diff", "terminal"],
    activeRightPanelTab: "diff",
    isRightPanelOpen: true,
    isRightPanelFocused: false,
  });
});
test("tool selectors expose names and selection even with hidden labels", () => {
  render(<RightPanelHeader />);
  expect(
    screen.getByRole("button", { name: "变更" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const terminal = screen.getByRole("button", { name: "终端" });
  fireEvent.click(terminal);
  expect(terminal.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "打开工具" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "关闭终端面板（结束其中所有终端进程）",
    }),
  );
  expect(useLayoutStore.getState().openRightPanelTabs).toEqual(["diff"]);
});
test("all closed tools remain discoverable with localized empty state", () => {
  useLayoutStore.setState({
    openRightPanelTabs: [],
    activeRightPanelTab: null,
  });
  render(<RightPanelHeader />);
  expect(screen.getByText("选择工作工具")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "文件" }));
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("files");
});

test("closing the focused tool returns focus to the active tool", async () => {
  render(<RightPanelHeader />);
  const close = screen.getByRole("button", { name: "关闭变更面板" });
  close.focus();
  fireEvent.click(close);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "终端" }),
    ),
  );
});
