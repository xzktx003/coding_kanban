import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AcpSessionList } from "./AcpSessionList";
const state = vi.hoisted(() => ({
  sessions: [
    {
      sessionId: "a",
      agentId: "keke",
      title: "中文 ACP",
      updatedAt: "2026-10-07T00:00:00Z",
    },
  ],
  opening: null,
  loading: false,
  error: null as string | null,
  open: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./useAcpSessions", () => ({ useAcpSessions: () => state }));
vi.mock("../common/RenameSessionButton", () => ({
  RenameSessionButton: () => <button>改名</button>,
}));
beforeEach(() => {
  state.error = null;
  state.loading = false;
  state.open.mockClear();
});
test("ACP rows support keyboard without activating from nested buttons", () => {
  render(<AcpSessionList directory="/fixture" />);
  const row = screen.getByRole("button", { name: /中文 ACP/ });
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: " " });
  expect(state.open).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByText("改名"), { key: "Enter" });
  expect(state.open).toHaveBeenCalledTimes(2);
});
test("ACP list distinguishes failure and provides retry", () => {
  state.error = "连接失败";
  render(<AcpSessionList directory="/fixture" />);
  expect(screen.getByRole("alert").textContent).toContain("连接失败");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(state.refresh).toHaveBeenCalled();
});
test("ACP deletion is explicit and failure remains retryable", async () => {
  state.remove.mockRejectedValueOnce(new Error("denied"));
  render(<AcpSessionList directory="/fixture" />);
  fireEvent.click(screen.getByRole("button", { name: "删除会话记录" }));
  expect(state.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
  expect((await screen.findByRole("alert")).textContent).toContain("denied");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
  expect(state.remove).toHaveBeenCalledTimes(2);
});
