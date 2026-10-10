import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConversationMenu } from "./ConversationMenu";
const request = vi.hoisted(() => vi.fn());
vi.mock("@session/features/thread-workflows/actions", () => ({
  threadWorkflowActions: { request },
}));
it("opens each workflow for the conversation that owns the menu", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  for (const [label, action] of [
    ["搜索会话", "search"],
    ["用户消息导航", "users"],
    ["导出 Markdown", "export"],
    ["复制会话链接", "copyLink"],
  ]) {
    fireEvent.keyDown(
      screen.getByRole("button", { name: "当前会话的更多操作" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(request).toHaveBeenLastCalledWith("original-owner", action);
  }
});
