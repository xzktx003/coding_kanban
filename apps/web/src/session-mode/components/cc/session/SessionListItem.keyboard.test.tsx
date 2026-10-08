import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionListItem } from "./SessionListItem";
vi.mock("../../common/RenameSessionButton", () => ({
  RenameSessionButton: () => <button>改名</button>,
}));
test("keyboard opens Claude row but nested controls do not open it", () => {
  const select = vi.fn();
  render(
    <SessionListItem
      session={{
        session_id: "keyboard",
        summary: "中文会话",
        last_modified: 1,
      }}
      isSelected={false}
      isActive={false}
      isLoading={false}
      onSelect={select}
      onCopyId={vi.fn()}
      onDeleteWorktree={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
  const row = screen.getByRole("button", { name: /中文会话/ });
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: " " });
  expect(select).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByRole("button", { name: "会话操作" }), { key: "Enter" });
  expect(select).toHaveBeenCalledTimes(2);
});
