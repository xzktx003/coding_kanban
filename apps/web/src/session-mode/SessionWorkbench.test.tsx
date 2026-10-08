import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
const statusSync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
const historySync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
vi.mock("./services/followedSessionHistorySync", () => ({
  startFollowedSessionHistorySync: historySync.start,
}));
vi.mock("./services/followedSessionStatusSync", () => ({
  startFollowedSessionStatusSync: statusSync.start,
}));
vi.mock("./App", () => ({
  default: () => <textarea aria-label="会话草稿" defaultValue="keep draft" />,
}));
vi.mock("./DataImportDialog", () => ({ DataImportDialog: () => null }));
import SessionWorkbench from "./SessionWorkbench";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("checks connection continuously and retains the mounted draft during an outage", async () => {
  statusSync.stop.mockClear();
  statusSync.start.mockReset().mockReturnValue(statusSync.stop);
  historySync.stop.mockClear();
  historySync.start.mockReset().mockReturnValue(historySync.stop);
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  vi.stubGlobal("fetch", fetch);
  const { unmount } = render(<SessionWorkbench />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  const draft = screen.getByLabelText("会话草稿");
  expect(statusSync.start).toHaveBeenCalledOnce();
  fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  expect(screen.getByRole("alert").textContent).toContain("连接中断");
  expect(screen.getByRole("alert").textContent).toContain("浏览器无法访问服务");
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  expect(statusSync.stop).toHaveBeenCalledOnce();
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000);
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  expect(statusSync.start).toHaveBeenCalledTimes(2);
  unmount();
  expect(statusSync.stop).toHaveBeenCalledTimes(2);
  expect(historySync.start).toHaveBeenCalledTimes(2);
  expect(historySync.stop).toHaveBeenCalledTimes(2);
});

it("rechecks immediately when the network reconnects and retains the draft", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "ok" }),
  }));
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<SessionWorkbench />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  const draft = screen.getByLabelText("会话草稿");
  fetcher.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  unmount();
});
