import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FollowupQueueContent } from "./FollowupQueue";

vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));

const message = {
  id: "q1",
  text: "稍后处理",
  images: [],
  status: "failed" as const,
  error: "SESSION_OWNED_ELSEWHERE",
};

it("uses the plugin continue and retry labels above the composer", () => {
  render(
    <FollowupQueueContent
      threadId="owner"
      turnId="turn"
      snapshot={{
        state: {
          revision: 1,
          paused: "interrupted",
          items: [message],
          undo: null,
        },
        error: "offline",
      } as never}
    />,
  );
  expect(screen.getByRole("button", { name: "继续" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "继续队列" })).toBeNull();
  expect(screen.queryByRole("button", { name: "重新连接并发送" })).toBeNull();
  expect(screen.queryByText("队列连接暂不可用，正在重试。")).toBeNull();
  expect(screen.getByText("由于你中断了当前响应，队列已暂停")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "排队消息操作 1" }));
  expect(screen.queryByRole("menuitem", { name: "暂停队列" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "清空队列" })).toBeNull();
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});
