import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionTopNavigation } from "./SessionTopNavigation";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
vi.mock("../../DataImportDialog", () => ({ DataImportDialog: () => null }));
beforeEach(() => {
  useLayoutStore.setState({ view: "agent" });
  useAgentCenterStore.setState({ cards: [], sharedTabsInitialized: true });
});
it("combines brand, primary page navigation and followed status in one row", () => {
  render(<SessionTopNavigation status="ready" onModeChange={vi.fn()} />);
  const nav = screen.getByRole("navigation", { name: "会话工作台导航" });
  expect(nav.querySelectorAll("img")).toHaveLength(1);
  expect(nav.querySelector("img")?.getAttribute("alt")).toBe("Houmo");
  expect(screen.queryByText("Coding Kanban")).toBeNull();
  expect(screen.getByRole("button", { name: "关注 0" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "定时任务" }));
  expect(useLayoutStore.getState().view).toBe("automations");
  fireEvent.click(screen.getByRole("button", { name: "会话" }));
  expect(useLayoutStore.getState().view).toBe("agent");
});
it("announces reconnection instead of claiming no pending requests", () => {
  render(<SessionTopNavigation status="offline" />);
  expect(screen.getByRole("button", { name: "正在重连" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "关注 0" })).toBeNull();
});
it("reports unsynchronized followed state separately from an empty set", () => {
  useAgentCenterStore.setState({ sharedTabsInitialized: false });
  render(<SessionTopNavigation status="ready" />);
  expect(screen.getByRole("button", { name: "状态待同步" })).toBeTruthy();
});
