import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const family = vi.hoisted(() => ({
  rows: [
    {
      node: { thread: { id: "child" }, createdInTurn: "old" },
      state: "unknown",
      pending: 0,
      current: false,
    },
  ],
  family: { complete: false },
  turn: undefined as string | undefined,
}));
vi.mock("./hooks", () => ({ useSubagentFamily: () => family }));
vi.mock("./service", () => ({ openSubagents: vi.fn(), closeSubagents: vi.fn() }));
import { SubagentSummary } from "./SubagentSummary";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { openSubagents } from "./service";
it("cached child birth data does not imply a known zero before the parent's current turn is restored", () => {
  render(<SubagentSummary root="root" />);
  expect(screen.getByRole("button", { name: /进行中待确认/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /进行中 0/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /本轮子任务 0/ })).toBeNull();
});

it("does not revive the removed tool tab or close the workspace for a stale subagent tab value", () => {
  // Persisted legacy state can survive a mounted component during migration.
  useLayoutStore.setState({
    activeRightPanelTab: "subagents" as never,
    isRightPanelOpen: true,
  });
  render(<SubagentSummary root="root" />);
  fireEvent.click(screen.getByRole("button", { name: "查看子任务" }));
  expect(openSubagents).toHaveBeenCalledWith("root");
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  expect(screen.queryByRole("button", { name: "收起子任务" })).toBeNull();
  useLayoutStore.setState({
    activeRightPanelTab: "files",
    isRightPanelOpen: false,
  });
});
