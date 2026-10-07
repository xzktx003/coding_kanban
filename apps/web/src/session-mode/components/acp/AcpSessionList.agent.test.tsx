import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AcpSessionList } from "./AcpSessionList";
vi.mock("./useAcpSessions", () => ({
  useAcpSessions: () => ({
    sessions: [
      {
        sessionId: "session",
        agentId: "keke",
        agentTitle: "Keke",
        title: "ACP work",
        updatedAt: "2026-10-07T00:00:00Z",
      },
    ],
    opening: null,
    open: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("../common/RenameSessionButton", () => ({
  RenameSessionButton: () => null,
}));
test("ACP sidebar markers name the actual agent instead of only the protocol", () => {
  render(<AcpSessionList directory="/fixture" />);
  expect(screen.getByLabelText("Agent: ACP · Keke").textContent).toBe(
    "ACP · Keke",
  );
  expect(screen.getByText("ACP work")).toBeTruthy();
});
