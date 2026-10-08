import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
const statusSync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
const historySync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
vi.mock("./services/followedSessionHistorySync", () => ({
  startFollowedSessionHistorySync: historySync.start,
}));
vi.mock("./services/followedSessionStatusSync", () => ({
  startFollowedSessionStatusSync: statusSync.start,
}));
vi.mock("./services/followedSessionAuxSync", () => ({
  startFollowedSessionAuxSync: () => () => {},
}));
vi.mock("./services/sessionTranscriptCache", () => ({
  startSessionTranscriptCache: () => () => {},
}));
vi.mock("./App", () => ({
  default: () => <textarea aria-label="会话草稿" defaultValue="keep draft" />,
}));
vi.mock("./DataImportDialog", () => ({ DataImportDialog: () => null }));
import SessionWorkbench from "./SessionWorkbench";
it("foreground and online wakes keep a healthy synchronization manager mounted", async () => {
  vi.useFakeTimers();
  statusSync.start.mockReset().mockReturnValue(statusSync.stop);
  statusSync.stop.mockReset();
  historySync.start.mockReset().mockReturnValue(historySync.stop);
  historySync.stop.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ status: "ok" }) })),
  );
  const { unmount } = render(<SessionWorkbench />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(historySync.start).toHaveBeenCalledOnce();
  expect(historySync.stop).not.toHaveBeenCalled();
  unmount();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("health probe failure keeps reconciliation alive alongside the mounted draft", async () => {
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
  expect(statusSync.stop).not.toHaveBeenCalled();
  expect(historySync.stop).not.toHaveBeenCalled();
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000);
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  expect(statusSync.start).toHaveBeenCalledOnce();
  unmount();
  expect(statusSync.stop).toHaveBeenCalledOnce();
  expect(historySync.start).toHaveBeenCalledOnce();
  expect(historySync.stop).toHaveBeenCalledOnce();
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

it("shows the remote update in session navigation and switches only when clicked", async () => {
  const onModeChange = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/app-version"
        ? {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                autoUpdate: {
                  enabled: true,
                  phase: "available",
                  branch: "v1.3.0",
                  remoteHead: "abcdef123456",
                },
              }),
          }
        : { ok: true, json: async () => ({ status: "ok" }) },
    ),
  );
  const { unmount } = render(<SessionWorkbench onModeChange={onModeChange} />);

  const button = await screen.findByRole("button", {
    name: /远程有新版本，切换到终端模式处理/,
  });
  expect(onModeChange).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(onModeChange).toHaveBeenCalledWith("terminal");
  unmount();
});
