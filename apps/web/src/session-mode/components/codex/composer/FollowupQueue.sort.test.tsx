import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FollowupMessage } from "@agent-orchestrator/shared";
import { FollowupQueueContent } from "./FollowupQueue";
import { followupService } from "@session/services/followupService";

vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
function fixture(statuses: FollowupMessage["status"][]) {
  const items = statuses.map((status, index) => ({
    id: `q${index}`,
    threadId: "owner",
    text: `message ${index}`,
    images: [],
    parameters: {},
    status,
    mode: "queue" as const,
    createdAt: 1,
    fingerprint: `q${index}`,
  }));
  return render(
    <FollowupQueueContent
      compactShelf
      threadId="owner"
      turnId="turn"
      snapshot={{
        state: { revision: 1, paused: null, items },
        error: undefined,
      }}
    />,
  );
}
it("does not offer sorting for a single queued message", () => {
  const view = fixture(["queued"]);
  expect(view.container.querySelector(".session-queue-drag-handle")).toBeNull();
});
it.each(["sending", "failed", "uncertain"] as const)(
  "disables the entire sortable list when another message is %s",
  (status) => {
    const view = fixture(["queued", status]);
    expect(
      view.container.querySelector(".session-queue-drag-handle"),
    ).toBeNull();
  },
);
it("offers focused sortable handles only for an all-queued list", () => {
  fixture(["queued", "queued"]);
  const handles = screen.getAllByRole("button", { name: /拖动排序排队消息/ });
  expect(handles).toHaveLength(2);
  expect(handles[0].getAttribute("aria-roledescription")).toBe("sortable");
  expect(handles[0].tabIndex).toBe(0);
  expect(handles[0].draggable).toBe(false);
});
it("ignores HTML drag payloads from another queue or browser application", () => {
  const view = fixture(["queued", "queued"]);
  fireEvent.drop(view.container.querySelectorAll("li")[1], {
    dataTransfer: { getData: () => "q0" },
  });
  expect(followupService.change).not.toHaveBeenCalled();
});
