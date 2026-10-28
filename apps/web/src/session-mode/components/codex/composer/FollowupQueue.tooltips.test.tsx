import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FollowupMessage } from "@agent-orchestrator/shared";
import { FollowupQueueContent } from "./FollowupQueue";
import { followupService } from "@session/services/followupService";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { threadAccess } from "@session/services/apiAdapt/codex";
import {
  resetCodexAccessCache,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";

/**
 * Codex 26.51007.21434 `queued-message-list-172645190dd2.js` gives every queue
 * row three hover affordances our rows were missing. Traced verbatim:
 *
 * - A failed/unconfirmed row carries a warning glyph in a top tooltip:
 *   `side:"top", tooltipClassName:"max-w-80"`, body
 *   `text-center whitespace-normal leading-snug`, wrapped in
 *   `<span className="mt-0.5 inline-flex shrink-0">` around
 *   `icon-2xs text-warning`. Its content switches on the uncertain flag:
 *   `deliveryUnconfirmed` alone, or `pausedTooltip` plus a second
 *   `opacity-65` paragraph of `pausedTooltipRemedy`.
 * - The row's primary action shares one tooltip slot: when it reads `retry`
 *   the body is `retryTooltip` + `opacity-65` `retryTooltipRemedy`; otherwise
 *   it is the steer button and the body is the single `sendNowTooltip`.
 * - The per-row menu ends with a `text-codex-description` item toggling the
 *   default follow-up behaviour: `turnOff` when queueing is on, else `turnOn`.
 *
 * Our menu trigger keeps its `排队消息操作 <n>` suffix: several rows render at
 * once and each needs a distinct accessible name, which the official single
 * `more` label cannot give. That suffix is ours by design, not a drift.
 *
 * zh-CN strings come from the official `zh-CN-b05cfd55c534.js` catalog, so the
 * assertions below are the shipped wording rather than a translation of ours.
 */
const base: FollowupMessage = {
  id: "q1",
  threadId: "owner",
  text: "你好",
  images: [],
  parameters: { model: "captured", cwd: "/original" },
  mode: "queue",
  createdAt: 1,
  fingerprint: "captured",
  status: "queued",
};
const snapshot = (items: FollowupMessage[], paused: string | null = null) => ({
  state: { revision: 7, paused, items },
  error: undefined,
});
function mount(
  items: FollowupMessage[],
  { turnId = "t1", paused = null as string | null } = {},
) {
  return render(
    <FollowupQueueContent
      threadId="owner"
      turnId={turnId}
      snapshot={snapshot(items, paused)}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  resetCodexAccessCache();
  // The toggle writes a persisted preference; reset it so order cannot leak.
  useFollowupSettingsStore.getState().setMode("queue");
  vi.mocked(threadAccess).mockResolvedValue({
    state: "owned",
    reason: "",
    generation: 1,
  });
  useCodexAccessStore.setState({
    entries: {
      owner: { access: { state: "owned", reason: "", generation: 1 } },
    },
  });
});
vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));
vi.mock("@session/services/apiAdapt/codex", () => ({ threadAccess: vi.fn() }));

it("explains a failed row with the official two-line warning tooltip", async () => {
  mount([{ ...base, status: "failed", error: "拒绝" }], {
    paused: "消息发送失败",
  });
  const warning = await screen.findByRole("button", {
    name: "这条排队中的消息未能发送",
  });
  // The remedy line is the official secondary paragraph, dimmed to 65%.
  expect(warning.getAttribute("aria-description")).toBe(
    "重试、编辑或删除该消息以继续发送排队的消息",
  );
  expect(warning.querySelector("[data-queue-warning-icon]")).not.toBeNull();
});

it("warns against silent deletion when delivery is unconfirmed", async () => {
  mount([{ ...base, status: "uncertain" }], { paused: "送达待确认" });
  const warning = await screen.findByRole("button", {
    name: "无法确认消息是否已送达。请先查看对话，再删除这条已保存的消息。",
  });
  // The uncertain branch is a single paragraph: no remedy line to show.
  expect(warning.getAttribute("aria-description")).toBeNull();
});

it("tells the steer button it submits without interrupting the run", async () => {
  mount([base]);
  const steer = await screen.findByRole("button", { name: "立即引导" });
  expect(steer.getAttribute("aria-description")).toBe("提交，但不中断模型运行");
});

it("offers the retry remedy on the retry action of a failed row", async () => {
  mount([{ ...base, status: "failed", error: "拒绝" }], {
    paused: "消息发送失败",
  });
  const retry = await screen.findByRole("button", { name: "重试" });
  expect(retry.getAttribute("aria-description")).toBe(
    "尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它",
  );
});

it("toggles the default follow-up behaviour from the row menu", async () => {
  mount([base]);
  // Radix opens on pointer/keyboard, not a bare jsdom click; siblings use ArrowDown.
  const open = () =>
    fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 1" }), {
      key: "ArrowDown",
    });
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "关闭排队" }));
  // Switching to steer must flip the item to the opposite official label.
  await waitFor(() =>
    expect(useFollowupSettingsStore.getState().mode).toBe("steer"),
  );
  open();
  expect(
    await screen.findByRole("menuitem", { name: "启用队列模式" }),
  ).toBeTruthy();
});
