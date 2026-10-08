import { render, screen } from "@testing-library/react";
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
vi.mock("./service", () => ({ openSubagents: vi.fn() }));
import { SubagentSummary } from "./SubagentSummary";
it("cached child birth data does not imply a known zero before the parent's current turn is restored", () => {
  render(<SubagentSummary root="root" />);
  expect(screen.getByRole("button", { name: /本轮归属待确认/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /本轮子任务 0/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /运行 0/ })).toBeNull();
});
