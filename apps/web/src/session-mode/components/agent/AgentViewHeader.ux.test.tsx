import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@session/components/ui/sidebar", () => ({
  useSidebar: () => ({
    open: true,
    openMobile: false,
    isMobile: viewport.mobile,
  }),
  SidebarTrigger: () => null,
}));
vi.mock("@session/components/common/NewAgentButton", () => ({
  NewAgentButton: () => null,
}));
vi.mock("@session/features/git", () => ({ GitActions: () => null }));
vi.mock("./openApp/OpenAppMenu", () => ({ OpenAppMenu: () => null }));
vi.mock("@session/hooks", () => ({
  useTrafficLightConfig: () => ({ needsTrafficLightOffset: false }),
}));
vi.mock("@session/hooks/runtime", () => ({ isPhone: () => false }));
import { AgentViewHeader } from "./AgentViewHeader";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useAcpStore } from "../../stores/useAcpStore";
beforeEach(() => {
  viewport.mobile = false;
  useAcpStore.setState({ active: false });
  useAgentCenterStore.setState({ cards: [], cardsViewMode: "solo" });
  useLayoutStore.setState({ isRightPanelOpen: false });
});
it("names the selected layout and distinguishes opening tools from hiding them", () => {
  render(<AgentViewHeader />);
  const single = screen.getByRole("button", { name: "自由分屏" });
  expect(single.getAttribute("aria-pressed")).toBe("true");
  const grid = screen.getByRole("button", { name: "多会话网格" });
  fireEvent.click(grid);
  expect(grid.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "打开工具面板" }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
});

it("ACP displays its single conversation without changing saved card layout", () => {
  useAgentCenterStore.setState({ cardsViewMode: "grid" });
  useAcpStore.setState({ active: true, agentId: "fixture-agent" });
  render(<AgentViewHeader />);
  expect(
    screen
      .getByRole("button", { name: "自由分屏" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "多会话网格" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("grid");
});

it("mobile free split removes the redundant desktop tool row", () => {
  viewport.mobile = true;
  const { container } = render(<AgentViewHeader />);
  expect(container.querySelector(".session-agent-header")).toBeNull();
  expect(container.textContent).toBe("");
});
