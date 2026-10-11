import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./service", () => ({ openSubagents: actions.open }));
import { SubagentEvent } from "./SubagentEvent";
import { useSubagentStore } from "./store";
beforeEach(() => {
  actions.open.mockClear();
  useSubagentStore.setState({ nodes: {} });
});
it.each([
  ["spawnAgent", "inProgress", "创建中"],
  ["spawnAgent", "failed", "创建失败"],
  ["sendInput", "completed", "已发送消息"],
  ["resumeAgent", "completed", "已恢复"],
  ["closeAgent", "failed", "无法关闭"],
  ["closeAgent", "interrupted", "已中断"],
])(
  "uses native action text and disclosure for %s/%s",
  (tool, status, label) => {
    render(
      <SubagentEvent
        root="root"
        item={{
          id: "call",
          type: "collabAgentToolCall",
          tool,
          status,
          receiverThreadIds: ["child"],
          prompt: "Bounded public prompt",
        }}
      />,
    );
    const toggle = screen.getByRole("button", { name: `${label}1 个智能体` });
    expect(screen.queryByText("Bounded public prompt")).toBeNull();
    expect(screen.queryByText(new RegExp(`\\b${status}\\b`))).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Bounded public prompt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "child" }));
    expect(actions.open).toHaveBeenCalledWith("root", "child");
  },
);
it.each([
  ["started", "Review worker 开始工作"],
  ["completed", "Review worker 已完成"],
  ["interrupted", "Review worker 已中断"],
  ["interacted", "已向 Review worker 发送消息"],
])("uses native subagent activity text for %s", (kind, label) => {
  render(
    <SubagentEvent
      root="root"
      item={{
        id: "activity",
        type: "subAgentActivity",
        kind,
        agentPath: "root/review_worker",
        agentThreadId: "child",
      }}
    />,
  );
  expect(screen.getByText(label)).toBeTruthy();
});
