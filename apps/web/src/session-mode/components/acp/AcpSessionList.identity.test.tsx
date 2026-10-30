import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AcpSessionList } from "./AcpSessionList";
import { useAcpStore } from "@session/stores/useAcpStore";
const rows = [
  {
    sessionId: "source-A",
    nativeSessionId: "s1",
    agentId: "fixture",
    title: "Record A",
    cwd: "/fixture",
    updatedAt: "2026-10-30T00:00:00Z",
  },
  {
    sessionId: "source-B",
    nativeSessionId: "s1",
    agentId: "fixture",
    title: "Record B",
    cwd: "/fixture",
    updatedAt: "2026-10-30T00:00:00Z",
  },
];
vi.mock("./useAcpSessions", () => ({
  useAcpSessions: () => ({
    sessions: rows,
    opening: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    open: vi.fn(),
    remove: vi.fn(),
    confirmation: null,
  }),
}));
vi.mock("../common/SessionRowMenu", () => ({ SessionRowMenu: () => null }));
vi.mock("../common/SessionStatus", () => ({ SessionStatus: () => null }));
beforeEach(() => {
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: "fixture",
    connectionId: "B",
    sessionId: "s1",
    historySessionId: "source-B",
    running: true,
  });
});
test("sidebar marks only the exact current history source when two processes share a native session id", () => {
  render(<AcpSessionList directory="/fixture" />);
  expect(
    screen
      .getByRole("button", { name: /Record B/ })
      .getAttribute("aria-current"),
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /Record A/ })
      .getAttribute("aria-current"),
  ).toBeNull();
});
