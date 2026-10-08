import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ openProjectVsCodeWeb: vi.fn() }));
vi.mock("../../../lib/api", () => api);
import { VsCodePanel } from "./VsCodePanel";
import { useVsCodePanelStore } from "../../stores/useVsCodePanelStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
const response = (path: string) => ({
  url: `${window.location.origin}/vscode/?folder=${encodeURIComponent(path)}`,
  workingDirectory: path,
  provider: "code-server",
  reused: true,
});
beforeEach(() => {
  vi.clearAllMocks();
  useVsCodePanelStore.setState({
    pinnedPath: null,
    hasOpened: false,
    entries: {},
    aliases: {},
    loading: {},
    errors: {},
  });
  useWorkspaceStore.setState({ cwd: "/project-a" });
  api.openProjectVsCodeWeb.mockImplementation(async (path: string) =>
    response(path === "/alias-a" ? "/project-a" : path),
  );
});
test("follows projects, retains frame identity across tools/hide, and reuses directory aliases", async () => {
  const view = render(<VsCodePanel active />);
  const first = await screen.findByTitle("VS Code · /project-a");
  fireEvent.load(first);
  act(() => useWorkspaceStore.setState({ cwd: "/project-b" }));
  await screen.findByTitle("VS Code · /project-b");
  expect(first.isConnected).toBe(true);
  view.rerender(<VsCodePanel active={false} />);
  act(() => useWorkspaceStore.setState({ cwd: "/project-c" }));
  expect(api.openProjectVsCodeWeb).toHaveBeenCalledTimes(2);
  act(() => useWorkspaceStore.setState({ cwd: "/alias-a" }));
  view.rerender(<VsCodePanel active />);
  await waitFor(() =>
    expect(useVsCodePanelStore.getState().aliases["/alias-a"]).toBe(
      "/project-a",
    ),
  );
  expect(screen.getByTitle("VS Code · /project-a")).toBe(first);
  expect(document.querySelectorAll("iframe")).toHaveLength(2);
});
test("a pinned project survives conversation changes; unpin resumes following", async () => {
  render(<VsCodePanel active />);
  const first = await screen.findByTitle("VS Code · /project-a");
  fireEvent.load(first);
  fireEvent.click(screen.getByRole("button", { name: "固定当前编辑项目" }));
  act(() => useWorkspaceStore.setState({ cwd: "/project-b" }));
  expect(api.openProjectVsCodeWeb).toHaveBeenCalledTimes(1);
  expect(first.parentElement?.hidden).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "取消固定项目，跟随当前项目" }),
  );
  await screen.findByTitle("VS Code · /project-b");
  expect(first.isConnected).toBe(true);
});
test("failed startup remains retryable inside the pane without discarding another project", async () => {
  render(<VsCodePanel active />);
  const first = await screen.findByTitle("VS Code · /project-a");
  api.openProjectVsCodeWeb.mockRejectedValueOnce(new Error("编辑服务连接失败"));
  act(() => useWorkspaceStore.setState({ cwd: "/project-b" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "编辑服务连接失败",
  );
  expect(first.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
  await screen.findByTitle("VS Code · /project-b");
  expect(screen.queryByRole("alert")).toBeNull();
});
test("coalesces repeated open and keeps a late response attached only to its original project", async () => {
  let finish!: (value: unknown) => void;
  api.openProjectVsCodeWeb.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const first = useVsCodePanelStore.getState().ensure("/project-a");
  const duplicate = useVsCodePanelStore.getState().ensure("/project-a");
  expect(first).toBe(duplicate);
  await useVsCodePanelStore.getState().ensure("/project-b");
  finish(response("/project-a"));
  await first;
  expect(Object.keys(useVsCodePanelStore.getState().entries).sort()).toEqual([
    "/project-a",
    "/project-b",
  ]);
  expect(api.openProjectVsCodeWeb).toHaveBeenCalledTimes(2);
});
test("persists only device preferences, not live frame URLs or editor buffers", async () => {
  await useVsCodePanelStore.getState().ensure("/project-a");
  useVsCodePanelStore.getState().pin("/project-a");
  const saved = JSON.parse(
    localStorage.getItem("kanban.session.vscode-panel")!,
  ).state;
  expect(saved.pinnedPath).toBe("/project-a");
  expect(saved.entries).toBeUndefined();
  expect(saved.aliases).toBeUndefined();
});
test("does not embed an unexpected origin returned by an unhealthy service", async () => {
  api.openProjectVsCodeWeb.mockResolvedValue({
    ...response("/project-a"),
    url: "https://outside.invalid/vscode/",
  });
  await expect(
    useVsCodePanelStore.getState().ensure("/project-a"),
  ).rejects.toThrow("编辑器地址无效");
  expect(useVsCodePanelStore.getState().entries).toEqual({});
});
