import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  FollowupMessage,
  FollowupThread,
} from "@agent-orchestrator/shared";
import { FollowupQueueContent } from "./FollowupQueue";
import { followupService } from "@session/services/followupService";
import { threadAccess } from "@session/services/apiAdapt/codex";
import {
  resetCodexAccessCache,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";

vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));
vi.mock("@session/services/apiAdapt/codex", () => ({ threadAccess: vi.fn() }));

const message: FollowupMessage = {
  id: "q1",
  threadId: "owner",
  text: "你好",
  images: ["/preserved.png"],
  parameters: { model: "captured", cwd: "/original" },
  mode: "queue",
  createdAt: 1,
  fingerprint: "captured",
  status: "failed",
  error: "SESSION_OWNED_ELSEWHERE: occupied",
};
const snapshot = (
  items = [message],
  paused: string | null = "消息发送失败",
) => ({
  state: { revision: 7, paused, items },
  error: undefined,
});
function mount(items = [message], paused: string | null = "消息发送失败") {
  return render(
    <FollowupQueueContent
      threadId="owner"
      turnId={null}
      snapshot={snapshot(items, paused)}
    />,
  );
}
function access(
  state:
    | "owned"
    | "readonly"
    | "external"
    | "releasing"
    | "acquiring"
    | "unknown",
) {
  useCodexAccessStore.setState({
    entries: { owner: { access: { state, reason: "", generation: 1 } } },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  resetCodexAccessCache();
  vi.mocked(threadAccess).mockResolvedValue({
    state: "owned",
    reason: "",
    generation: 1,
  });
  vi.mocked(followupService.change).mockResolvedValue({
    revision: 8,
    paused: null,
    items: [],
  });
  vi.mocked(followupService.load).mockResolvedValue(snapshot().state);
});

it.each([
  "队列已暂停",
  "上一轮执行失败，请检查后继续",
  "重新连接后等待任务完成确认",
])("shows the actual pause reason: %s", (reason) => {
  mount([{ ...message, status: "queued", error: undefined }], reason);
  expect(screen.getByText(reason)).toBeTruthy();
  expect(screen.queryByText("由于你中断了当前响应，队列已暂停")).toBeNull();
});
it.each(["interrupted", "由于你中断了当前响应，队列已暂停"])(
  "shows legacy interruption %s without inventing a user stop or resending",
  (reason) => {
    mount([], reason);
    expect(screen.getByText("当前响应已中断，队列已暂停")).toBeTruthy();
    expect(screen.queryByText(/由于你中断/)).toBeNull();
    expect(followupService.change).not.toHaveBeenCalled();
  },
);
it("routes a failed message to its recovery actions and disables menu resume", async () => {
  mount();
  expect(screen.getByText("消息发送失败")).toBeTruthy();
  expect(screen.getByRole("button", { name: "处理失败消息" })).toBeTruthy();
  expect(screen.queryByText("由于你中断了当前响应，队列已暂停")).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 1" }), {
    key: "ArrowDown",
  });
  expect(
    (await screen.findByRole("menuitem", { name: "继续" })).getAttribute(
      "aria-disabled",
    ),
  ).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "继续" }));
  expect(followupService.change).not.toHaveBeenCalled();
});
it.each(["external", "releasing", "acquiring", "unknown"] as const)(
  "blocks both retry entrances while access is %s, retaining the item and attachment",
  async (state) => {
    access(state);
    mount();
    expect(
      (screen.getByRole("button", { name: "重试" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("你好")).toBeTruthy();
    expect(screen.getByAltText("排队附件 1")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 1" }), {
      key: "ArrowDown",
    });
    expect(
      (
        await screen.findByRole("menuitem", { name: /尝试重新发送/ })
      ).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(followupService.change).not.toHaveBeenCalled();
  },
);
it("refreshes read-only access immediately before retry and stops an ownership race", async () => {
  access("owned");
  vi.mocked(threadAccess).mockResolvedValue({
    state: "external",
    reason: "another writer",
    generation: 2,
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(threadAccess).toHaveBeenCalledWith(
      "owner",
      false,
      expect.any(AbortSignal),
    ),
  );
  await waitFor(() =>
    expect(useCodexAccessStore.getState().entries.owner.access?.state).toBe(
      "external",
    ),
  );
  expect(followupService.change).not.toHaveBeenCalled();
  expect(screen.getByText(/会话被其他客户端占用/)).toBeTruthy();
});
it("enables explicit retry after release without automatically resending", async () => {
  access("external");
  mount();
  act(() => access("readonly"));
  expect(followupService.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(followupService.change).toHaveBeenCalledExactlyOnceWith("owner", 7, {
      type: "retry",
      id: "q1",
    }),
  );
});
it("requires explicit confirmation for uncertain delivery", async () => {
  mount(
    [{ ...message, status: "uncertain", error: "DELIVERY_UNKNOWN" }],
    "送达结果待确认",
  );
  expect(screen.getByRole("button", { name: "核对送达状态" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(followupService.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认未送达并重试" }));
  await waitFor(() =>
    expect(followupService.change).toHaveBeenCalledExactlyOnceWith("owner", 7, {
      type: "retry",
      id: "q1",
      confirmUncertain: true,
    }),
  );
});
it("rechecks uncertain confirmation if ownership changes while the dialog is open", async () => {
  mount([{ ...message, status: "uncertain" }], "送达结果待确认");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  act(() => access("external"));
  expect(
    (
      screen.getByRole("button", {
        name: "确认未送达并重试",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(followupService.change).not.toHaveBeenCalled();
});
it("keeps remove available while externally owned", async () => {
  access("external");
  mount();
  fireEvent.click(screen.getByRole("button", { name: "删除排队的消息" }));
  await waitFor(() =>
    expect(followupService.change).toHaveBeenCalledWith("owner", 7, {
      type: "delete",
      id: "q1",
    }),
  );
  expect(threadAccess).not.toHaveBeenCalled();
});
it("opens hidden failed items for recovery instead of attempting resume", () => {
  mount([
    { ...message, id: "first", status: "queued", error: undefined },
    { ...message, id: "hidden", text: "hidden failure" },
  ]);
  expect(screen.queryByText("hidden failure")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "处理失败消息" }));
  expect(screen.getByText("hidden failure")).toBeTruthy();
  expect(followupService.change).not.toHaveBeenCalled();
});
it("revalidates the latest queue before resume instead of submitting a known conflict", async () => {
  mount([{ ...message, status: "queued", error: undefined }], "队列已暂停");
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() =>
    expect(followupService.load).toHaveBeenCalledWith("owner"),
  );
  expect(followupService.change).not.toHaveBeenCalled();
});
it("resumes an ordinary paused queue once using the refreshed revision", async () => {
  const state: FollowupThread = {
    revision: 9,
    paused: "队列已暂停",
    items: [{ ...message, status: "queued", error: undefined }],
  };
  vi.mocked(followupService.load).mockResolvedValue(state);
  mount(state.items, state.paused);
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() =>
    expect(followupService.change).toHaveBeenCalledExactlyOnceWith("owner", 9, {
      type: "resume",
    }),
  );
});

it("keeps resume disabled in both entrances while the writer is external", async () => {
  access("external");
  mount([{ ...message, status: "queued", error: undefined }], "队列已暂停");
  expect(
    (screen.getByRole("button", { name: "继续" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("button", { name: "排队消息操作 1" }), {
    key: "ArrowDown",
  });
  expect(
    (await screen.findByRole("menuitem", { name: "继续" })).getAttribute(
      "aria-disabled",
    ),
  ).toBe("true");
  expect(followupService.change).not.toHaveBeenCalled();
});

it("keeps a retry unchanged when the read-only access check fails", async () => {
  vi.mocked(threadAccess).mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(screen.getByText(/执行占用状态尚未确认/)).toBeTruthy(),
  );
  expect(followupService.change).not.toHaveBeenCalled();
  expect(screen.getByText("你好")).toBeTruthy();
  expect(screen.getByAltText("排队附件 1")).toBeTruthy();
});
