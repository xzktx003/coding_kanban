import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionListItem } from "./SessionListItem";

vi.mock("../../common/RenameSessionButton", () => ({
  RenameSessionButton: () => null,
}));

test("Claude sidebar sessions retain a visible agent marker even when inactive", () => {
  render(
    <SessionListItem
      session={{
        session_id: "claude-session",
        summary: "Review changes",
        last_modified: 1,
      }}
      isSelected={false}
      isActive={false}
      isLoading={false}
      onSelect={vi.fn()}
      onCopyId={vi.fn()}
      onDeleteWorktree={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Agent: Claude Code").textContent).toBe(
    "",
  );
  expect(screen.getByText("Review changes")).toBeTruthy();
});
