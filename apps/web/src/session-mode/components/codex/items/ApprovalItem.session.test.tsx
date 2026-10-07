import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApprovalItem } from "./ApprovalItem";
import { useApprovalStore } from "../stores";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("shows and answers only the request for this pane while another thread waits", () => {
  const a = {
    type: "fileChange" as const,
    requestId: 1,
    threadId: "a",
    turnId: "t",
    itemId: "i",
    reason: null,
    grantRoot: "/a",
    startedAtMs: 0,
  };
  const b = { ...a, requestId: 2, threadId: "b", grantRoot: "/b" };
  const respond = vi.fn().mockResolvedValue(undefined);
  useApprovalStore.setState({
    pendingApprovals: [a, b],
    currentApproval: a,
    respondToApproval: respond,
  });
  render(<ApprovalItem currentThreadId="b" />);
  expect(screen.getByText("/b")).toBeTruthy();
  expect(screen.queryByText("/a")).toBeNull();
  expect(screen.queryByText("common.pending")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "common.decline" }));
  expect(respond).toHaveBeenCalledWith(2, false, "decline");
});
it("does not show an approval belonging to another pane", () => {
  useApprovalStore.setState({
    pendingApprovals: [],
    currentApproval: {
      type: "fileChange",
      requestId: 1,
      threadId: "a",
      turnId: "t",
      itemId: "i",
      reason: null,
      grantRoot: "/a",
      startedAtMs: 0,
    },
  });
  const { container } = render(<ApprovalItem currentThreadId="b" />);
  expect(container.textContent).toBe("");
});
