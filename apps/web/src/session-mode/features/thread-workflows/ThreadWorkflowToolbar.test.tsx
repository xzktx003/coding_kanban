import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadWorkflowToolbar } from "./ThreadWorkflowToolbar";
import { threadWorkflowActions, useThreadWorkflowActions } from "./actions";
import { useThreadWorkflowStore } from "./delivery";
import { downloadThreadMarkdown } from "./service";
vi.mock("./service", () => ({ downloadThreadMarkdown: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh-CN" } }),
}));
const rows = [
  {
    rowId: "stable-key",
    itemId: "item",
    turnId: "turn",
    role: "user" as const,
    text: "Stable target 中文",
    completed: true,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  useThreadWorkflowActions.setState({ panels: {}, requests: {} });
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
});
it("only the visible owning panel consumes export even if the same thread remains mounted in a hidden mode", () => {
  render(
    <>
      <div hidden>
        <ThreadWorkflowToolbar
          threadId="owner"
          rows={[{ ...rows[0], text: "Hidden old source" }]}
          turns={[]}
          onNavigate={vi.fn()}
        />
      </div>
      <ThreadWorkflowToolbar
        threadId="owner"
        rows={[{ ...rows[0], text: "Visible chosen source" }]}
        turns={[]}
        onNavigate={vi.fn()}
      />
    </>,
  );
  act(() => threadWorkflowActions.request("owner", "export"));
  expect(vi.mocked(downloadThreadMarkdown).mock.calls[0][0]).toContain(
    "Visible chosen source",
  );
  expect(downloadThreadMarkdown).toHaveBeenCalledTimes(1);
});
it("a deliberate keyboard request focuses only its captured transcript panel", () => {
  const view = render(
    <>
      <div className="codex-presentation" data-testid="first">
        <ThreadWorkflowToolbar
          threadId="owner"
          rows={rows}
          turns={[]}
          onNavigate={vi.fn()}
        />
      </div>
      <div className="codex-presentation" data-testid="second">
        <ThreadWorkflowToolbar
          threadId="owner"
          rows={rows}
          turns={[]}
          onNavigate={vi.fn()}
        />
      </div>
    </>,
  );
  act(() =>
    threadWorkflowActions.request("owner", "search", {
      focus: true,
      ownerRoot: view.getByTestId("second"),
    }),
  );
  expect(document.activeElement).toBe(
    view.getByTestId("second").querySelector("input"),
  );
});
it("has zero idle content and opens the chosen thread search without passive autofocus", () => {
  const navigate = vi.fn();
  const { container } = render(
    <ThreadWorkflowToolbar
      threadId="owner"
      rows={rows}
      turns={[]}
      onNavigate={navigate}
    />,
  );
  expect(
    container.querySelector('[data-thread-workflows="owner"]')
      ?.childElementCount,
  ).toBe(0);
  act(() => threadWorkflowActions.request("other", "search"));
  expect(screen.queryByRole("textbox")).toBeNull();
  act(() => threadWorkflowActions.request("owner", "search"));
  const input = screen.getByRole("textbox", { name: "搜索会话正文" });
  expect(document.activeElement).not.toBe(input);
  fireEvent.change(input, { target: { value: "TARGET" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      rowId: "stable-key",
      itemId: "item",
      turnId: "turn",
      query: "TARGET",
      offset: 7,
    }),
  );
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("touch-compatible user navigation shares row anchors and close leaves focus alone", () => {
  const navigate = vi.fn();
  render(
    <ThreadWorkflowToolbar
      threadId="owner"
      rows={rows}
      turns={[]}
      onNavigate={navigate}
    />,
  );
  act(() => threadWorkflowActions.request("owner", "users"));
  fireEvent.click(screen.getByRole("button", { name: /Stable target 中文/ }));
  expect(navigate).toHaveBeenCalledWith(rows[0]);
  fireEvent.click(screen.getByRole("button", { name: "关闭用户消息导航" }));
  expect(screen.queryByRole("navigation")).toBeNull();
});
