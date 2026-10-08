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

it("toggles the persisted session theme in one click without changing navigation", async () => {
  const { useThemeStore } = await import("../../stores/settings/useThemeStore");
  useThemeStore.setState({ theme: "dark" });
  render(<SessionTopNavigation status="ready" />);
  fireEvent.click(screen.getByRole("button", { name: "切换为浅色模式" }));
  expect(useThemeStore.getState().theme).toBe("light");
  expect(
    JSON.parse(localStorage.getItem("kanban.session.theme-storage")!).state
      .theme,
  ).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: "切换为深色模式" }));
  expect(useThemeStore.getState().theme).toBe("dark");
  expect(useLayoutStore.getState().view).toBe("agent");
});

it("changes layout globally and shows the selected session tool target", async () => {
  const { useAcpStore } = await import("../../stores/useAcpStore");
  const { useWorkspaceStore } = await import("../../stores/useWorkspaceStore");
  useAcpStore.setState({ active: false });
  useWorkspaceStore.setState({ cwd: "/unrelated/stale" });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "own", cwd: "/work/own-project" }],
    currentAgentCardId: "own",
    currentAgentCardKind: "codex",
    cardsViewMode: "solo",
  });
  render(<SessionTopNavigation status="ready" />);
  fireEvent.click(screen.getByRole("button", { name: "多会话网格" }));
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("grid");
  fireEvent.keyDown(screen.getByRole("button", { name: "更多功能" }), {
    key: "Enter",
  });
  expect(screen.getByText("工具目标：own-project")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "终端" }));
  expect(useWorkspaceStore.getState().cwd).toBe("/work/own-project");
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("terminal");
});
it("disables project tools for an unknown session instead of reusing the last cwd", async () => {
  const { useWorkspaceStore } = await import("../../stores/useWorkspaceStore");
  useWorkspaceStore.setState({ cwd: "/unrelated/stale" });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "unknown" }],
    currentAgentCardId: "unknown",
    currentAgentCardKind: "codex",
    cardsViewMode: "solo",
  });
  render(<SessionTopNavigation status="ready" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "更多功能" }), {
    key: "Enter",
  });
  expect(screen.getByText("工具目标：请先选择项目")).toBeTruthy();
  expect(
    screen
      .getByRole("menuitem", { name: "终端" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    screen
      .getByRole("menuitem", { name: "VS Code" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});

it("keeps an explicitly pinned editor available for a session with unknown project", async () => {
  const { useVsCodePanelStore } =
    await import("../../stores/useVsCodePanelStore");
  useVsCodePanelStore.setState({ pinnedPath: "/pinned/project" });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "unknown" }],
    currentAgentCardId: "unknown",
    currentAgentCardKind: "codex",
    cardsViewMode: "solo",
  });
  render(<SessionTopNavigation status="ready" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "更多功能" }), {
    key: "Enter",
  });
  expect(screen.getByText("VS Code 已固定：/pinned/project")).toBeTruthy();
  expect(
    screen
      .getByRole("menuitem", { name: "VS Code" })
      .getAttribute("aria-disabled"),
  ).not.toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "VS Code" }));
  expect(useVsCodePanelStore.getState().pinnedPath).toBe("/pinned/project");
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("vscode");
  useVsCodePanelStore.setState({ pinnedPath: null });
});
