import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeActivityItem } from "./NativeActivityItem";
const { open, selectTab } = vi.hoisted(() => ({
  open: vi.fn(async () => true),
  selectTab: vi.fn(),
}));
vi.mock("@session/features/thread-workflows/threadLinkService", () => ({
  openThreadLink: open,
}));
vi.mock("@session/hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({ selectTab }),
}));
const item = {
  type: "dynamicToolCall",
  id: "tool",
  namespace: "codex_app",
  tool: "read_thread",
  arguments: { threadId: "child" },
  status: "inProgress",
  success: null,
  contentItems: null,
};
it("opens only the actual native target through verified history-only navigation", () => {
  render(<NativeActivityItem item={item as never} running />);
  fireEvent.click(screen.getByRole("button", { name: "正在读取聊天" }));
  expect(open).toHaveBeenCalledWith({ threadId: "child" }, selectTab);
});
it("preserves foreign and ChatGPT identity with a focusable unavailable explanation and no local redirect", () => {
  open.mockClear();
  render(
    <NativeActivityItem
      item={
        {
          ...item,
          tool: "create_thread",
          status: "completed",
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: '{"kind":"chatgpt","threadId":"remote"}',
            },
          ],
        } as never
      }
    />,
  );
  const button = screen.getByRole("button", { name: "已创建聊天" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(screen.getByText(/当前未提供.*ChatGPT/)).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});
it("uses the native settings approval label only for a real pending config object", () => {
  render(
    <NativeActivityItem
      item={
        { ...item, tool: "write_settings", arguments: { config: {} } } as never
      }
      running
    />,
  );
  expect(screen.getAllByText("等待批准")[0]).toBeTruthy();
  expect(screen.queryByText(/config/)).toBeNull();
});
