import { describe, expect, it } from "vitest";
import {
  composerDeliveryNoticeText,
  type ComposerDeliveryNotice,
} from "./composerDeliveryNotice";

describe("delivery notice follows current queue and turn state", () => {
  const notice: ComposerDeliveryNotice = {
    owner: "thread-a",
    text: "消息已接收，将按顺序发送",
    queue: true,
  };
  const state = { paused: null, interrupted: false };

  it("never promises that accepted means the queued message will execute", () => {
    expect(composerDeliveryNoticeText(notice, "thread-a", state)).toBe(
      "消息已接收，请查看当前会话进度",
    );
  });

  it("replaces the accepted notice when the queue pauses or the turn is interrupted", () => {
    expect(
      composerDeliveryNoticeText(notice, "thread-a", {
        ...state,
        paused: "interrupted",
      }),
    ).toBe("消息已接收，队列已暂停；请查看待发送消息");
    expect(
      composerDeliveryNoticeText(notice, "thread-a", {
        ...state,
        interrupted: true,
      }),
    ).toBe("当前轮次已中断；请查看待发送消息");
  });

  it("does not present stale success while the queue cannot be read", () => {
    expect(
      composerDeliveryNoticeText(notice, "thread-a", {
        ...state,
        error: "offline",
      }),
    ).toBe("消息已接收；队列状态暂不可用，请检查");
  });

  it("keeps other actions and session ownership independent", () => {
    expect(
      composerDeliveryNoticeText(notice, "thread-b", state),
    ).toBeUndefined();
    expect(
      composerDeliveryNoticeText(
        { owner: "thread-a", text: "引导已提交" },
        "thread-a",
        { ...state, interrupted: true },
      ),
    ).toBe("引导已提交");
  });
});
