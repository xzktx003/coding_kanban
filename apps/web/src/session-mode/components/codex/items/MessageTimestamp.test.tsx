import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EventItem } from "./EventItem";
import { buildThreadRows } from "../thread/threadRows";
import type { ServerNotification } from "@session/bindings";
vi.mock("./UserMessageItem", () => ({
  EditableUserMessageItem: () => <div>user body</div>,
}));
vi.mock("./AgentMessageItem", () => ({
  AgentMessageItem: () => <div>assistant body</div>,
}));
afterEach(cleanup);
const ms = new Date(2026, 9, 19, 14, 5, 9).getTime();
const message = (user: boolean, time = ms): ServerNotification =>
  user
    ? ({
        method: "item/started",
        params: {
          threadId: "t",
          turnId: "r",
          startedAtMs: time,
          item: { type: "userMessage", id: "u", clientId: null, content: [] },
        },
      } as ServerNotification)
    : ({
        method: "item/completed",
        params: {
          threadId: "t",
          turnId: "r",
          completedAtMs: time,
          item: { type: "agentMessage", id: "a", text: "reply" },
        },
      } as ServerNotification);
it.each([true, false])(
  "shows persistent local date and seconds for message user=%s",
  (user) => {
    const { container } = render(<EventItem event={message(user)} />);
    const time = container.querySelector("time")!;
    expect(time).not.toBeNull();
    expect(time.textContent).toContain("2026-10-19 14:05:09");
    expect(time.dateTime).toBe(new Date(ms).toISOString());
    expect(time.closest(".invisible")).toBeNull();
  },
);
it.each([0, NaN, Infinity, -1, 9e20])(
  "does not fabricate unknown/invalid timestamps %s",
  (value) => {
    const { container } = render(<EventItem event={message(true, value)} />);
    expect(container.querySelector("time")).toBeNull();
  },
);
it("uses explicitly labelled turn times for restored history with zero item times", () => {
  const events = [
    message(true, 0),
    message(false, 0),
    {
      method: "turn/completed",
      params: {
        threadId: "t",
        turn: {
          id: "r",
          items: [],
          itemsView: "full",
          error: null,
          durationMs: 60000,
          status: "completed",
          startedAt: ms / 1000,
          completedAt: ms / 1000 + 60,
        },
      },
    } as ServerNotification,
  ];
  const rows = buildThreadRows(events);
  for (const row of rows) {
    if (row.item.kind !== "event") continue;
    const { container, unmount } = render(
      <EventItem event={row.item.event} context={row.context} />,
    );
    const time = container.querySelector("time")!;
    expect(time).not.toBeNull();
    expect(time.textContent).toContain(
      row.item.event.method === "item/started"
        ? "轮次开始 · 2026-10-19 14:05:09"
        : "轮次结束 · 2026-10-19 14:06:09",
    );
    unmount();
  }
});

it("prefers native item time over a turn fallback", () => {
  const { container } = render(
    <EventItem
      event={message(false)}
      context={{ messageTimestamp: { ms: ms + 60000, label: "轮次结束" } }}
    />,
  );
  expect(container.querySelector("time")?.textContent).toBe(
    "2026-10-19 14:05:09",
  );
});
