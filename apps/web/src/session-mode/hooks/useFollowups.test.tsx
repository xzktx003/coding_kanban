import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../services/followupService", () => ({
  followupService: { load: io.load },
  useFollowupStore: (select: (state: unknown) => unknown) =>
    select({ threads: {}, errors: {} }),
}));
import { useFollowups } from "./useFollowups";
import { useLayoutStore } from "../stores/useLayoutStore";
let root: HTMLDivElement;
let hidden = false;
let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  online = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  io.load
    .mockReset()
    .mockResolvedValue({ revision: 1, items: [], paused: null });
  useLayoutStore.setState({ view: "agent" });
  root = document.createElement("div");
  root.className = "session-mode";
  document.body.append(root);
});
afterEach(() => {
  cleanup();
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const visibility = (value: boolean) =>
  act(() => {
    hidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  });

it("does not read while initially hidden and performs one read when visible", async () => {
  hidden = true;
  renderHook(() => useFollowups("a"));
  await advance(10000);
  expect(io.load).not.toHaveBeenCalled();
  visibility(false);
  await flush();
  expect(io.load).toHaveBeenCalledExactlyOnceWith("a");
});

it("pauses an existing timer while hidden and coalesces wake events", async () => {
  renderHook(() => useFollowups("a"));
  await flush();
  expect(io.load).toHaveBeenCalledTimes(1);
  visibility(true);
  await advance(10000);
  expect(io.load).toHaveBeenCalledTimes(1);
  visibility(false);
  act(() => window.dispatchEvent(new Event("online")));
  await flush();
  expect(io.load).toHaveBeenCalledTimes(2);
  await advance(1500);
  expect(io.load).toHaveBeenCalledTimes(3);
});

it("pauses preserved composers in another workbench mode or secondary page", async () => {
  renderHook(() => useFollowups("a"));
  await flush();
  act(() => {
    root.hidden = true;
    window.dispatchEvent(new Event("workbench-mode-changed"));
  });
  await advance(6000);
  expect(io.load).toHaveBeenCalledTimes(1);
  act(() => {
    root.hidden = false;
    window.dispatchEvent(new Event("workbench-mode-changed"));
  });
  await flush();
  expect(io.load).toHaveBeenCalledTimes(2);
  act(() => useLayoutStore.setState({ view: "settings" }));
  await advance(6000);
  expect(io.load).toHaveBeenCalledTimes(2);
  act(() => useLayoutStore.setState({ view: "agent" }));
  await flush();
  expect(io.load).toHaveBeenCalledTimes(3);
});

it("shares one polling observer for two visible consumers of the same thread", async () => {
  const first = renderHook(() => useFollowups("a"));
  const second = renderHook(() => useFollowups("a"));
  await flush();
  expect(io.load).toHaveBeenCalledTimes(1);
  await advance(1500);
  expect(io.load).toHaveBeenCalledTimes(2);
  first.unmount();
  await advance(1500);
  expect(io.load).toHaveBeenCalledTimes(3);
  second.unmount();
  await advance(6000);
  expect(io.load).toHaveBeenCalledTimes(3);
});

it("retains an in-flight shared receipt read and schedules nothing after the last consumer leaves", async () => {
  let resolve!: (value: unknown) => void;
  io.load.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { unmount } = renderHook(() => useFollowups("a"));
  await flush();
  expect(io.load).toHaveBeenCalledExactlyOnceWith("a");
  visibility(true);
  unmount();
  await act(async () => resolve({ revision: 2, items: [], paused: null }));
  await advance(6000);
  expect(io.load).toHaveBeenCalledTimes(1);
});

it("keeps independent thread observers and releases the previous target on change", async () => {
  const first = renderHook(({ id }) => useFollowups(id), {
    initialProps: { id: "a" },
  });
  renderHook(() => useFollowups("b"));
  await flush();
  expect(io.load.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
  first.rerender({ id: "b" });
  await advance(1500);
  expect(io.load.mock.calls.map((call) => call[0])).toEqual(["a", "b", "b"]);
});

it("pauses offline polling and resumes one read on reconnect", async () => {
  renderHook(() => useFollowups("a"));
  await flush();
  act(() => {
    online = false;
    window.dispatchEvent(new Event("offline"));
  });
  await advance(6000);
  expect(io.load).toHaveBeenCalledTimes(1);
  act(() => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  expect(io.load).toHaveBeenCalledTimes(2);
});
