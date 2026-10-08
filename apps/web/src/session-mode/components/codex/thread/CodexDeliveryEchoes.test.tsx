import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
vi.mock("../items/UserMessageItem", () => ({
  UserMessageItem: ({ content }: any) => (
    <div>
      {content.map((c: any, i: number) => (
        <span key={i}>{c.text || c.path}</span>
      ))}
    </div>
  ),
}));
const api = vi.hoisted(() => ({
  postJsonWithOptions: vi.fn(),
  getJsonWithOptions: vi.fn(),
}));
const resume = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreadHistory: resume },
}));
vi.mock("@session/services/apiAdapt/shared", () => api);
import { CodexDeliveryEchoes } from "./CodexDeliveryEchoes";
import {
  beginDeliveryEcho,
  reconcileDeliveryEchoes,
  clearDeliveryEchoes,
  useCodexDeliveryStore,
} from "@session/stores/useCodexDeliveryStore";
import {
  followupService,
  useFollowupStore,
} from "@session/services/followupService";
import { useCodexStore } from "../stores";
const message = {
  id: "request",
  threadId: "a",
  text: "hello",
  images: ["/image.png"],
  mode: "queue" as const,
  parameters: {},
};
const receipt = (status: string) =>
  ({
    revision: 1,
    paused: null,
    items: [
      { ...message, status, turnId: "turn", createdAt: 1, fingerprint: "f" },
    ],
  }) as any;
const event = (method = "item/started") =>
  ({
    method,
    params: {
      threadId: "a",
      turnId: "turn",
      item: {
        type: "userMessage",
        id: "native",
        clientId: "request",
        content: [],
      },
    },
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  useCodexDeliveryStore.setState({ entries: {} });
  useFollowupStore.setState({ threads: {}, errors: {} });
  useCodexStore.setState({ currentThreadId: "a", events: {} });
});
it("retains a sent message and its attachment while the event is delayed; removes only the matched echo", () => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  beginDeliveryEcho({ ...message, id: "other", threadId: "b" });
  const view = render(<CodexDeliveryEchoes threadId="a" events={[]} />);
  expect(screen.getByText("hello")).toBeTruthy();
  expect(screen.getByText("/image.png")).toBeTruthy();
  expect(screen.getByText("已接收，等待消息同步")).toBeTruthy();
  view.rerender(
    <CodexDeliveryEchoes threadId="a" events={[event("item/completed")]} />,
  );
  expect(screen.queryByText("hello")).toBeNull();
  expect(
    Object.values(useCodexDeliveryStore.getState().entries).map(
      (e) => e.threadId,
    ),
  ).toEqual(["b"]);
});
it("leaves queued messages with the queue UI, then shows the sent receipt without a blank interval", () => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("queued"));
  render(<CodexDeliveryEchoes threadId="a" events={[]} />);
  expect(screen.queryByText("hello")).toBeNull();
  act(() => reconcileDeliveryEchoes("a", receipt("sent")));
  expect(screen.getByText("hello")).toBeTruthy();
});
it("does not resurrect archived sent receipts on refresh or after rollback", () => {
  reconcileDeliveryEchoes("a", receipt("sent"));
  expect(Object.keys(useCodexDeliveryStore.getState().entries)).toHaveLength(0);
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  clearDeliveryEchoes("a");
  reconcileDeliveryEchoes("a", receipt("sent"));
  expect(Object.keys(useCodexDeliveryStore.getState().entries)).toHaveLength(0);
});
it("does not merge identical messages by their text", () => {
  beginDeliveryEcho(message);
  beginDeliveryEcho({ ...message, id: "second" });
  render(<CodexDeliveryEchoes threadId="a" events={[event()]} />);
  expect(screen.getAllByText("hello")).toHaveLength(1);
  expect(Object.values(useCodexDeliveryStore.getState().entries)[0].id).toBe(
    "second",
  );
});
it("shows submission before HTTP returns and retains content on a lost response", async () => {
  let reject!: (e: Error) => void;
  api.postJsonWithOptions.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  render(<CodexDeliveryEchoes threadId="a" events={[]} />);
  const pending = followupService
    .submit("owner", 1, "a", "hello", [], "queue", undefined, {})
    .catch((e) => e);
  await vi.waitFor(() => expect(api.postJsonWithOptions).toHaveBeenCalled());
  expect(screen.getByText("正在提交")).toBeTruthy();
  await act(async () => {
    reject(new Error("network lost"));
    await pending;
  });
  expect(screen.getByText("hello")).toBeTruthy();
  expect(screen.getByText("送达待确认，请核对会话或队列")).toBeTruthy();
});
it("an event before the HTTP response cannot be reinserted by that response", async () => {
  let resolve!: (v: any) => void;
  api.postJsonWithOptions.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<CodexDeliveryEchoes threadId="a" events={[]} />);
  const pending = followupService.submit(
    "owner",
    1,
    "a",
    "hello",
    [],
    "queue",
    undefined,
    {},
  );
  await vi.waitFor(() => expect(api.postJsonWithOptions).toHaveBeenCalled());
  const submitted = api.postJsonWithOptions.mock.calls[0][1];
  const incoming = event();
  incoming.params.item.clientId = submitted.id;
  view.rerender(<CodexDeliveryEchoes threadId="a" events={[incoming]} />);
  await act(async () => {
    resolve({
      revision: 1,
      paused: null,
      items: [{ ...submitted, status: "sent", turnId: "turn" }],
    });
    await pending;
  });
  expect(screen.queryByText("hello")).toBeNull();
});
it("an accepted message reports execution failure instead of waiting forever for its native echo", () => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  const failed: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "turn",
        status: "failed",
        items: [],
        error: { message: "at capacity" },
      },
    },
  };
  render(<CodexDeliveryEchoes threadId="a" events={[failed]} />);
  expect(screen.getByRole("status").textContent).toContain("本轮执行失败");
  expect(screen.queryByText("已接收，等待消息同步")).toBeNull();
  expect(screen.getByText("hello")).toBeTruthy();
  expect(resume).toHaveBeenCalledExactlyOnceWith("a", undefined, {
    background: true,
  });
});
it("does not treat retrying, other-thread, or older-turn errors as failure of this submission", () => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  const error = (
    threadId: string,
    turnId: string,
    willRetry: boolean,
  ): any => ({
    method: "error",
    params: { threadId, turnId, willRetry, error: { message: "busy" } },
  });
  render(
    <CodexDeliveryEchoes
      threadId="a"
      events={[
        error("a", "old", false),
        error("b", "turn", false),
        error("a", "turn", true),
      ]}
    />,
  );
  expect(screen.getByText("已接收，等待消息同步")).toBeTruthy();
  expect(resume).not.toHaveBeenCalled();
});
it("refreshes once on terminal error and reconciles the persisted userMessage by clientId", async () => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  const error: any = {
    method: "error",
    params: {
      threadId: "a",
      turnId: "turn",
      willRetry: false,
      error: { message: "invalid input" },
    },
  };
  resume.mockRejectedValueOnce(new Error("offline"));
  const view = render(<CodexDeliveryEchoes threadId="a" events={[error]} />);
  await act(async () => {});
  view.rerender(<CodexDeliveryEchoes threadId="a" events={[error, error]} />);
  expect(resume).toHaveBeenCalledTimes(1);
  expect(screen.getByText("hello")).toBeTruthy();
  const completed: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: { id: "turn", status: "failed", items: [event().params.item] },
    },
  };
  view.rerender(
    <CodexDeliveryEchoes threadId="a" events={[error, completed]} />,
  );
  expect(screen.queryByText("hello")).toBeNull();
  expect(resume).toHaveBeenCalledTimes(1);
});
it.each([
  ["completed", "本轮已结束"],
  ["interrupted", "本轮已停止"],
])("shows %s receipts without an endless syncing label", (status, label) => {
  beginDeliveryEcho(message);
  reconcileDeliveryEchoes("a", receipt("sent"));
  const completed: any = {
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "turn", status, items: [] } },
  };
  render(<CodexDeliveryEchoes threadId="a" events={[completed]} />);
  expect(screen.getByRole("status").textContent).toContain(label);
});
