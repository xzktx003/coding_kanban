import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OfflineWorkspace } from "./OfflineWorkspace";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
beforeEach(() => {
  useWorkspaceStore.setState({
    projects: ["/a", "/b"],
    cwd: "/a",
    pendingProjectOperations: [],
    nextProjectSequence: 1,
  });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a" },
      { kind: "cc", id: "b" },
    ],
    pendingTabOperations: [],
    nextTabSequence: 1,
    currentAgentCardId: "a",
    currentAgentCardKind: "codex",
  });
});
it("cached projects/tabs can be reordered or removed with durable pending operations while disconnected", () => {
  render(<OfflineWorkspace retry={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "上移项目 /b" }));
  expect(useWorkspaceStore.getState().projects).toEqual(["/b", "/a"]);
  fireEvent.change(screen.getByRole("textbox", { name: "保存项目路径" }), {
    target: { value: "/c" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(useWorkspaceStore.getState().projects).toContain("/c");
  fireEvent.click(screen.getByRole("button", { name: "移出关注会话 b" }));
  expect(useAgentCenterStore.getState().pendingTabOperations[0].action).toEqual(
    { type: "remove", key: "cc:b" },
  );
  expect(
    JSON.parse(localStorage.getItem("kanban.session.workspace")!).state
      .pendingProjectOperations.length,
  ).toBeGreaterThan(0);
});
