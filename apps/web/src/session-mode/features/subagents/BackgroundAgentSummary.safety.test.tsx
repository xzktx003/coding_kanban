import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const calls = vi.hoisted(() => ({
  stop: vi.fn(async () => {}),
  message: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./service", () => ({ subagentService: { stop: calls.stop } }));
vi.mock("sonner", () => ({
  toast: { message: calls.message, error: calls.error },
}));
import { BackgroundAgentSummary } from "./BackgroundAgentSummary";
import { useSubagentStore } from "./store";
import { useCodexStore } from "@session/components/codex/stores";
const child = (id: string, createdInTurn?: string, verified = true) => ({
  thread: {
    id,
    name: id,
    parentThreadId: "root",
    status: { type: "active" },
    turns: [{ id: "child-" + id, status: "inProgress", items: [] }],
  },
  parentId: "root",
  createdInTurn,
  verified,
  unavailable: false,
  revision: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  useSubagentStore.setState({
    nodes: {
      current: child("current", "parent-round"),
      old: child("old", "old-round"),
      unknown: child("unknown"),
      unverified: child("unverified", "parent-round", false),
    } as any,
  });
  useCodexStore.setState({
    currentThreadId: "root",
    account: {
      type: "chatgpt",
      email: "same@example.invalid",
      planType: "plus",
    },
    accountNamespace: "workspace-a",
    turnTimingMap: {
      root: { turnId: "parent-round", status: "completed" },
    } as any,
  });
});
const open = () => {
  render(<BackgroundAgentSummary threadId="root" />);
  fireEvent.click(screen.getByRole("button", { name: /子智能体 ·/ }));
  fireEvent.click(screen.getByRole("button", { name: "全部停止" }));
};
it("requires explicit confirmation showing only verified current-round targets", async () => {
  open();
  expect(calls.stop).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("current");
  expect(dialog.textContent).not.toMatch(/old|unknown|unverified/);
  fireEvent.click(within(dialog).getByRole("button", { name: "确认停止" }));
  await waitFor(() =>
    expect(calls.stop).toHaveBeenCalledWith("root", [
      { threadId: "current", turnId: "child-current" },
    ]),
  );
  expect(calls.stop).toHaveBeenCalledTimes(1);
});
it("cancel does not interrupt any child", () => {
  open();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
  );
  expect(calls.stop).not.toHaveBeenCalled();
});
it("a changed parent round invalidates the captured confirmation", async () => {
  open();
  useCodexStore.setState({
    turnTimingMap: {
      root: { turnId: "next-round", status: "inProgress" },
    } as any,
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认停止",
    }),
  );
  await waitFor(() => expect(calls.message).toHaveBeenCalled());
  expect(calls.stop).not.toHaveBeenCalled();
});
it("a scope that changes and later returns cannot revive an old confirmation", async () => {
  open();
  const original = useCodexStore.getState().turnTimingMap;
  useCodexStore.setState({
    turnTimingMap: {
      root: { turnId: "next-round", status: "inProgress" },
    } as any,
  });
  useCodexStore.setState({ turnTimingMap: original });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认停止",
    }),
  );
  await waitFor(() =>
    expect(calls.message).toHaveBeenCalledWith(
      "任务范围已变化，请重新确认停止名单",
    ),
  );
  expect(calls.stop).not.toHaveBeenCalled();
});
it("a changed child turn or same-email workspace invalidates the captured scope", async () => {
  open();
  useCodexStore.setState({ accountNamespace: "workspace-b" });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认停止",
    }),
  );
  await waitFor(() => expect(calls.message).toHaveBeenCalled());
  expect(calls.stop).not.toHaveBeenCalled();
  useCodexStore.setState({ accountNamespace: "workspace-a" });
  fireEvent.click(screen.getByRole("button", { name: "全部停止" }));
  useSubagentStore.setState((s) => ({
    nodes: {
      ...s.nodes,
      current: {
        ...s.nodes.current,
        thread: {
          ...s.nodes.current.thread,
          turns: [
            { id: "new-child-turn", status: "inProgress", items: [] },
          ] as any,
        },
      },
    },
  }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认停止",
    }),
  );
  expect(calls.stop).not.toHaveBeenCalled();
});
it("confirmation sends once and holds the original child turn while the response is pending", async () => {
  let finish!: () => void;
  calls.stop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  open();
  const button = within(screen.getByRole("dialog")).getByRole("button", {
    name: "确认停止",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(calls.stop).toHaveBeenCalledTimes(1);
  expect(calls.stop.mock.calls[0]).toEqual([
    "root",
    [{ threadId: "current", turnId: "child-current" }],
  ]);
  finish();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
