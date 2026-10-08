import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentCardHeader } from "./AgentCardHeader";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
vi.mock("../common/RenameSessionButton", () => ({
  RenameSessionButton: () => null,
}));
vi.mock("../common/SessionStatus", () => ({
  SessionStatus: () => null,
  UnreadDot: () => null,
}));
const cards = [
  {
    kind: "codex" as const,
    id: "project-a",
    preview: "同名会话",
    cwd: "/company/api",
  },
  {
    kind: "cc" as const,
    id: "project-b",
    preview: "同名会话",
    cwd: "/research/api",
  },
];
beforeEach(() => {
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: cards[0].id,
    currentAgentCardKind: "codex",
    detachedCard: null,
  });
  useWorkspaceStore.setState({ cwd: "/company/api" });
});
it("shows the own project on an unselected card and opens details without selecting it", () => {
  const select = vi.fn();
  render(<AgentCardHeader card={cards[1]} onSelect={select} />);
  const project = screen.getByRole("button", {
    name: "项目详情：research/api",
  });
  fireEvent.keyDown(project, { key: "Enter" });
  expect(screen.getByText("/research/api")).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("project-a");
  expect(useWorkspaceStore.getState().cwd).toBe("/company/api");
});
it("keeps unknown project explicit when another project is selected", () => {
  render(
    <AgentCardHeader
      card={{ kind: "codex", id: "unknown", preview: "缺失目录" }}
    />,
  );
  expect(screen.getByText("项目未知")).toBeTruthy();
  expect(screen.queryByText("api")).toBeNull();
});
it("moves cards in grid/list without selecting or closing them", () => {
  const select = vi.fn();
  render(<AgentCardHeader card={cards[1]} onSelect={select} />);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "排列会话：同名会话" }),
    { key: "Enter" },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "向前移动" }));
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "project-b",
    "project-a",
  ]);
  expect(select).not.toHaveBeenCalled();
});

it("reorders within saved split groups without changing their membership or focus", async () => {
  const { useSessionSplitStore } =
    await import("../../stores/useSessionSplitStore");
  useSessionSplitStore.setState({
    activeGroupId: "one",
    tree: {
      type: "group",
      id: "one",
      keys: ["codex:project-a", "cc:project-b"],
      selected: "codex:project-a",
    },
  });
  render(<AgentCardHeader card={cards[1]} />);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "排列会话：同名会话" }),
    { key: "Enter" },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "向前移动" }));
  expect(useSessionSplitStore.getState().tree).toEqual({
    type: "group",
    id: "one",
    keys: ["cc:project-b", "codex:project-a"],
    selected: "codex:project-a",
  });
  expect(useSessionSplitStore.getState().activeGroupId).toBe("one");
});
