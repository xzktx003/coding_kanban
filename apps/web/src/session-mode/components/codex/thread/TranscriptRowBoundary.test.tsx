import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TranscriptRowBoundary } from "./TranscriptRowBoundary";

const fixture = { fail: true };

function MaybeBrokenMessage() {
  if (fixture.fail) throw new Error("fixture message render error");
  return <p>原消息恢复</p>;
}

it("keeps neighboring messages visible when one transcript row fails", () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <>
      <TranscriptRowBoundary threadId="thread" rowKey="before">
        <p>上一条消息</p>
      </TranscriptRowBoundary>
      <TranscriptRowBoundary threadId="thread" rowKey="broken-item">
        <MaybeBrokenMessage />
      </TranscriptRowBoundary>
      <TranscriptRowBoundary threadId="thread" rowKey="after">
        <p>下一条消息</p>
      </TranscriptRowBoundary>
    </>,
  );

  expect(screen.getByText("上一条消息")).toBeTruthy();
  expect(screen.getByText("下一条消息")).toBeTruthy();
  expect(
    screen.getByText("此消息暂时无法显示，其余消息仍可继续查看。"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试此消息" })).toBeTruthy();
  expect(
    errorLog.mock.calls.some(
      ([message, details]) =>
        message === "[CodexTranscript] Message row failed." &&
        (details as { threadId?: string; rowKey?: string }).threadId ===
          "thread" &&
        (details as { rowKey?: string }).rowKey === "broken-item" &&
        (details as { error?: Error }).error?.message ===
          "fixture message render error",
    ),
  ).toBe(true);

  fixture.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "重试此消息" }));
  expect(screen.getByText("原消息恢复")).toBeTruthy();
  expect(
    screen.queryByText("此消息暂时无法显示，其余消息仍可继续查看。"),
  ).toBeNull();
  fixture.fail = true;
  errorLog.mockRestore();
});
