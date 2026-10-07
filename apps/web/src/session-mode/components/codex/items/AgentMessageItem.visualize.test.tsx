import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi, beforeEach } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { readWorkspaceVisualization } from "@session/services/workspaceFiles";
import { useCodexStore } from "../stores/useCodexStore";
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceVisualization: vi.fn(),
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
beforeEach(() => {
  vi.mocked(readWorkspaceVisualization).mockReset().mockResolvedValue({
    path: "/project/mock.html",
    version: "v1",
    content: '<button id="fixture">Interactive fixture</button>',
    size: 56,
  });
  useWorkspaceStore.setState({ cwd: "/project", projects: ["/project"] });
});
it("turns a Codex visualize marker into an isolated HTML preview", async () => {
  useWorkspaceStore.setState({ cwd: "/project", projects: ["/project"] });
  render(
    <AgentMessageItem
      text={
        'Before\nvisualize{"path":"/project/mock.html","mode":"wide"}\nAfter'
      }
    />,
  );
  const frame = await screen.findByTitle("可视化预览：mock");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("srcdoc")).toContain("Interactive fixture");
  expect(screen.queryByText(/visualize/)).toBeNull();
});
it("does not read unfinished streaming markers or code examples", async () => {
  const view = render(<AgentMessageItem text={'visualize{"path":'} />);
  expect(screen.getByRole("status").textContent).toContain("正在接收");
  expect(readWorkspaceVisualization).not.toHaveBeenCalled();
  view.rerender(
    <AgentMessageItem
      text={'```text\nvisualize{"path":"/project/mock.html"}\n```'}
    />,
  );
  expect(readWorkspaceVisualization).not.toHaveBeenCalled();
  view.rerender(
    <AgentMessageItem text={'visualize{"path":"/project/mock.html"}'} />,
  );
  await screen.findByTitle("可视化预览：mock");
  expect(readWorkspaceVisualization).toHaveBeenCalledTimes(1);
});
it("shows a file error and retries without changing the conversation", async () => {
  vi.mocked(readWorkspaceVisualization).mockRejectedValueOnce(
    new Error("文件不存在"),
  );
  render(
    <AgentMessageItem text={'visualize{"path":"/project/mock.html"}'} />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "文件不存在",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByTitle("可视化预览：mock");
  expect(readWorkspaceVisualization).toHaveBeenCalledTimes(2);
});
it("uses the message thread project and ignores foreign frame messages", async () => {
  useCodexStore.setState({
    threads: [{ id: "thread-viz", cwd: "/original" } as never],
  });
  render(
    <AgentMessageItem
      threadId="thread-viz"
      text={'visualize{"path":"/original/mock.html","mode":"wide"}'}
    />,
  );
  const frame = (await screen.findByTitle(
    "可视化预览：mock",
  )) as HTMLIFrameElement;
  expect(readWorkspaceVisualization).toHaveBeenCalledWith(
    "/original",
    "/original/mock.html",
  );
  const nonce = JSON.parse(
    frame.srcdoc.match(/\)\((\{"nonce":.*?\})\);<\/script>/)![1],
  ).nonce;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: window,
      data: { nonce, type: "session-visualization-error", message: "foreign" },
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { nonce, type: "session-visualization-size", height: 9000 },
    }),
  );
  await waitFor(() => expect(frame.style.height).toBe("1600px"));
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        nonce,
        type: "session-visualization-error",
        message: "fixture error",
      },
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain("fixture error");
});
