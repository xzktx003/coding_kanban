import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerRail, ComposerRailItem } from "./ComposerRail";
import { FollowupQueueContent, hasVisibleFollowupQueue } from "./FollowupQueue";

vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));

const snapshot: Parameters<typeof hasVisibleFollowupQueue>[1] = {
  state: {
    revision: 1,
    paused: null,
    items: [
      {
        id: "q1",
        threadId: "owner",
        text: "稍后处理",
        images: [],
        status: "queued",
        parameters: {},
        mode: "queue",
        createdAt: 1,
        fingerprint: "fixture",
      },
    ],
  },
  error: undefined,
};
const originalWidth = window.innerWidth;
afterEach(() =>
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  }),
);

it("shows every desktop queued row and keeps each configuration entry accessible", async () => {
  const second = {
    ...snapshot.state.items[0],
    id: "q2",
    text: "第二条完整消息",
  };
  render(
    <FollowupQueueContent
      compactShelf
      threadId="owner"
      turnId="turn"
      snapshot={{
        ...snapshot,
        state: { ...snapshot.state, items: [...snapshot.state.items, second] },
      }}
    />,
  );
  expect(screen.getByText("第二条完整消息")).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "预览排队消息 2：第二条完整消息" }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: "删除排队的消息" }),
  ).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 2" }), {
    key: "ArrowDown",
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "查看发送配置与上下文" }),
  );
  expect(screen.getAllByLabelText("入队时的发送配置")).toHaveLength(2);
});

it("keeps the mobile shelf compact while its detail sheet exposes all queued messages", () => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  const second = {
    ...snapshot.state.items[0],
    id: "q2",
    text: "第二条完整消息",
  };
  render(
    <FollowupQueueContent
      compactShelf
      threadId="owner"
      turnId="turn"
      snapshot={{
        ...snapshot,
        state: { ...snapshot.state, items: [...snapshot.state.items, second] },
      }}
    />,
  );
  expect(screen.queryByText("第二条完整消息")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "还有 1 条待发送" }));
  expect(screen.getByText("第二条完整消息")).toBeTruthy();
});

function Fixture({ visible = true }) {
  return (
    <ComposerRail>
      <ComposerRailItem visible={visible}>
        <FollowupQueueContent
          threadId="owner"
          turnId="turn"
          compactShelf
          snapshot={snapshot}
        />
      </ComposerRailItem>
    </ComposerRail>
  );
}

it("closes a queued message's portaled menu as soon as its rail item exits", async () => {
  const view = render(<Fixture />);
  fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 1" }), {
    key: "ArrowDown",
  });
  expect(await screen.findByRole("menu")).toBeTruthy();
  view.rerender(<Fixture visible={false} />);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(
    view.container
      .querySelector("[data-composer-rail-item=exiting]")
      ?.hasAttribute("inert"),
  ).toBe(true);
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-composer-rail-item]"),
    ).toBeNull(),
  );
});

it("keeps paused and failed-connection shelves visible without queued rows", () => {
  const empty = { ...snapshot, state: { ...snapshot.state, items: [] } };
  expect(hasVisibleFollowupQueue("owner", empty)).toBe(false);
  expect(hasVisibleFollowupQueue("owner", { ...empty, error: "offline" })).toBe(
    true,
  );
  expect(
    hasVisibleFollowupQueue("owner", {
      ...empty,
      state: { ...empty.state, paused: "interrupted" },
    }),
  ).toBe(true);
  expect(hasVisibleFollowupQueue(null, snapshot)).toBe(false);
});
