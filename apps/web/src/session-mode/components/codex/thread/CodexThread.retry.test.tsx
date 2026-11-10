import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CodexThread } from "./CodexThread";

const fixture = vi.hoisted(() => ({
  failingThreadId: "retry-thread",
  rejectNextTranscriptImport: false,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    lazy: (load: () => Promise<{ default: ComponentType<any> }>) =>
      actual.lazy(() => {
        if (fixture.rejectNextTranscriptImport) {
          fixture.rejectNextTranscriptImport = false;
          return Promise.reject(new Error("fixture transcript import error"));
        }
        return load();
      }),
  };
});

vi.mock("./CodexTranscript", () => ({
  default: ({ activeThreadId }: { activeThreadId: string }) => {
    if (fixture.failingThreadId === activeThreadId)
      throw new Error("fixture transcript render error");
    return <div>完整消息加载成功：{activeThreadId}</div>;
  },
}));
vi.mock("../hooks/useTranscriptVisibility", () => ({
  useTranscriptVisibility: () => ({
    ref: () => {},
    renderTranscript: true,
    visible: true,
  }),
}));

afterEach(() => {
  fixture.failingThreadId = "retry-thread";
  fixture.rejectNextTranscriptImport = false;
  vi.restoreAllMocks();
});

it("logs the render failure and retries the rich transcript without reloading the page", async () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<CodexThread threadId="retry-thread" />);

  expect((await screen.findByRole("alert")).textContent).toContain(
    "近期正文和草稿仍已保留",
  );
  expect(
    screen.getByText("Error: fixture transcript render error"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新页面" })).toBeTruthy();
  expect(
    errorLog.mock.calls.some(
      ([message, details]) =>
        message === "[CodexThread] Transcript renderer failed." &&
        (
          details as {
            threadId?: string;
            error?: Error;
            componentStack?: string;
          }
        ).threadId === "retry-thread" &&
        (details as { error?: Error }).error?.message ===
          "fixture transcript render error" &&
        Boolean((details as { componentStack?: string }).componentStack),
    ),
  ).toBe(true);

  fixture.failingThreadId = "";
  fireEvent.click(screen.getByRole("button", { name: "重试完整消息" }));
  expect(
    await screen.findByText("完整消息加载成功：retry-thread"),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("recreates the lazy renderer when switching away from a failed thread", async () => {
  const { rerender } = render(<CodexThread threadId="retry-thread" />);
  expect(await screen.findByRole("alert")).toBeTruthy();

  fixture.failingThreadId = "";
  rerender(<CodexThread threadId="healthy-thread" />);

  expect(
    await screen.findByText("完整消息加载成功：healthy-thread"),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retries a rejected lazy import after switching threads", async () => {
  fixture.failingThreadId = "";
  fixture.rejectNextTranscriptImport = true;
  const { rerender } = render(<CodexThread threadId="load-error-thread" />);

  expect(await screen.findByRole("alert")).toBeTruthy();

  rerender(<CodexThread threadId="healthy-thread" />);

  expect(
    await screen.findByText("完整消息加载成功：healthy-thread"),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps refresh and error details available after a rejected lazy import", async () => {
  fixture.failingThreadId = "";
  fixture.rejectNextTranscriptImport = true;
  render(<CodexThread threadId="same-thread-import-error" />);

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新页面" })).toBeTruthy();
  expect(screen.getByText("查看错误详情")).toBeTruthy();
});
