import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { McpToolCallItem } from "./McpToolCallItem";
const captured = vi.hoisted(() => vi.fn());
vi.mock("@session/features/mcp-apps/McpAppView", () => ({
  McpAppView: (props: object) => {
    captured(props);
    return <button>打开精确应用</button>;
  },
}));
const item = {
  type: "mcpToolCall",
  id: "native-item",
  server: "docs",
  tool: "widget",
  status: "completed",
  appContext: { resourceUri: "ui://docs/widget" },
  arguments: null,
  result: null,
  error: null,
} as never;
it("supplies the native resource view with exact event owner IDs", async () => {
  render(
    <McpToolCallItem
      item={item}
      threadId="original-thread"
      turnId="original-turn"
    />,
  );
  await screen.findByRole("button", { name: "打开精确应用" });
  expect(captured).toHaveBeenCalledWith({
    threadId: "original-thread",
    turnId: "original-turn",
    itemId: "native-item",
  });
});
it("does not infer a missing app target from the currently selected conversation", () => {
  const view = render(<McpToolCallItem item={item} />);
  expect(view.queryByRole("button", { name: "打开精确应用" })).toBeNull();
});
