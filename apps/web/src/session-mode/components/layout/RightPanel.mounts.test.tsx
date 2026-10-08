import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RightPanel } from "./RightPanel";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@session/hooks/useGitWatch", () => ({ useGitWatch: () => {} }));
vi.mock("./RightPanelHeader", () => ({
  RightPanelHeader: () => <div>工具栏</div>,
}));
vi.mock("@session/stores", async () => ({
  useLayoutStore: (await import("@session/stores/useLayoutStore"))
    .useLayoutStore,
  useWorkspaceStore: () => ({ cwd: "" }),
}));
vi.mock("@session/stores/useGitStatsStore", () => ({
  useGitStatsStore: () => ({ refreshStats: vi.fn() }),
}));
vi.mock("../../features/web-preview/webFrameworkDetection", () => ({
  detectWebFramework: async () => null,
}));
vi.mock("@session/features/git/GitDiffPanel", () => ({
  default: () => <div>变更内容</div>,
}));
vi.mock("@session/components/agent/TasksPanel", () => new Promise(() => {}));
vi.mock("@session/features/todos/TodoView", () => ({
  default: () => <div>待办内容</div>,
}));
vi.mock("@session/features/terminal/TerminalPanel", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalPanel: () => {
      useEffect(() => {
        lifecycle.mounts++;
        return () => {
          lifecycle.unmounts++;
        };
      }, []);
      return <input aria-label="测试终端输入" />;
    },
  };
});
beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
  useLayoutStore.setState({
    openRightPanelTabs: ["terminal", "diff"],
    activeRightPanelTab: "terminal",
  });
});
test("switching tools preserves terminal DOM, draft and mount identity", async () => {
  render(<RightPanel />);
  const terminal = await screen.findByRole("textbox", { name: "测试终端输入" });
  (terminal as HTMLInputElement).value = "未发送草稿";
  act(() => useLayoutStore.getState().setActiveRightPanelTab("diff"));
  await waitFor(() => expect(screen.getByText("变更内容")).toBeTruthy());
  act(() => useLayoutStore.getState().setActiveRightPanelTab("todo"));
  await screen.findByText("待办内容");
  act(() => useLayoutStore.getState().setActiveRightPanelTab("terminal"));
  expect(screen.getByRole("textbox", { name: "测试终端输入" })).toBe(terminal);
  expect((terminal as HTMLInputElement).value).toBe("未发送草稿");
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
});

test("lazy tool switching names the loading state instead of showing a blank panel", () => {
  useLayoutStore.setState({
    openRightPanelTabs: ["tasks"],
    activeRightPanelTab: "tasks",
  });
  render(<RightPanel />);
  expect(screen.getByRole("status").textContent).toContain("正在加载看板");
});

// Hiding a tool is distinct from explicitly ending its terminal process.
test("closing the terminal tool tab preserves its process-owning tree until explicit terminal close", async () => {
  render(<RightPanel />);
  const terminal = await screen.findByRole("textbox", { name: "测试终端输入" });
  (terminal as HTMLInputElement).value = "保留终端输入";
  act(() => useLayoutStore.getState().closeRightPanelTab("terminal"));
  expect(terminal.isConnected).toBe(true);
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  act(() => useLayoutStore.getState().setActiveRightPanelTab("terminal"));
  expect(await screen.findByRole("textbox", { name: "测试终端输入" })).toBe(
    terminal,
  );
  expect((terminal as HTMLInputElement).value).toBe("保留终端输入");
});
