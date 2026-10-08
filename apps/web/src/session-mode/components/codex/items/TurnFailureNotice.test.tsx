import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EventItem } from "./EventItem";
vi.mock("./ThreadFileChangesSummary", () => ({
  ThreadFileChangesSummary: () => <div>文件改动仍保留</div>,
}));
it("shows a persisted failed turn even when no standalone error event was replayed", () => {
  render(
    <EventItem
      event={
        {
          method: "turn/completed",
          params: {
            threadId: "a",
            turn: {
              id: "failed",
              status: "failed",
              items: [],
              error: {
                message: JSON.stringify({
                  error: {
                    message:
                      "Invalid 'input[1853].arguments': string too long. Expected maximum length 1048576, got length 2815158.",
                  },
                }),
              },
            },
          },
        } as any
      }
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "历史工具调用参数过长",
  );
  expect(screen.getByText("查看错误详情")).toBeTruthy();
});
it("a retry or error from another turn does not hide the final failure", () => {
  const retry: any = {
    method: "error",
    params: {
      threadId: "a",
      turnId: "t",
      error: { message: "busy" },
      willRetry: true,
    },
  };
  const old: any = {
    ...retry,
    params: { ...retry.params, turnId: "old", willRetry: false },
  };
  const completion: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "t",
        status: "failed",
        items: [],
        error: { message: "final failure" },
      },
    },
  };
  render(
    <EventItem
      event={completion}
      context={{ events: [retry, old, completion], eventIndex: 2 }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("final failure");
});
it("keeps the file summary visible together with a persisted failure", () => {
  const completion: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "t",
        status: "failed",
        items: [
          {
            type: "fileChange",
            id: "f",
            changes: [
              { path: "file.ts", kind: { type: "add" }, diff: "+test" },
            ],
          },
        ],
        error: null,
      },
    },
  };
  render(<EventItem event={completion} />);
  expect(screen.getByRole("alert").textContent).toContain("本轮执行失败");
  expect(screen.getByText("文件改动仍保留")).toBeTruthy();
});
it("labels transient errors as retrying instead of terminal failure", () => {
  const event: any = {
    method: "error",
    params: {
      threadId: "a",
      turnId: "t",
      error: { message: "busy" },
      willRetry: true,
    },
  };
  render(<EventItem event={event} />);
  expect(screen.getByRole("alert").textContent).toContain("正在自动重试");
  expect(screen.queryByText("本轮执行失败")).toBeNull();
});
it("does not duplicate a failure already rendered for the same turn", () => {
  const error: any = {
    method: "error",
    params: {
      threadId: "a",
      turnId: "t",
      error: { message: "at capacity" },
      willRetry: false,
    },
  };
  const completion: any = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "t",
        status: "failed",
        items: [],
        error: { message: "at capacity" },
      },
    },
  };
  const { container } = render(
    <EventItem
      event={completion}
      context={{ events: [error, completion], eventIndex: 1 } as any}
    />,
  );
  expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
});
