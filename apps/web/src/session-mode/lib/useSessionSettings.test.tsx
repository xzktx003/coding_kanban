import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  remote: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("./settings", () => ({
  loadSettings: mocks.load,
  loadRemoteSettings: mocks.remote,
}));
vi.mock("../hooks/runtime", () => ({ isPhone: () => false }));
vi.mock("sonner", () => ({
  toast: { warning: mocks.warning, dismiss: mocks.dismiss },
}));
import { useSessionSettings } from "./useSessionSettings";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => vi.useRealTimers());

it("bounds a hung read, cancels its transport and permits an explicit local retry", async () => {
  let signal!: AbortSignal;
  mocks.load.mockImplementationOnce((value: AbortSignal) => {
    signal = value;
    return new Promise(() => {});
  });
  const { unmount } = renderHook(useSessionSettings);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_001);
  });
  expect(signal.aborted).toBe(true);
  expect(mocks.warning).toHaveBeenCalledOnce();
  const action = mocks.warning.mock.calls[0][1].action;
  mocks.load.mockResolvedValueOnce(undefined);
  await act(async () => {
    action.onClick();
  });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load.mock.calls[1][0].aborted).toBe(false);
  expect(mocks.dismiss).toHaveBeenCalledWith("session-display-name-sync");
  unmount();
});

it("unmount aborts its own read and never displays a late failure", async () => {
  let signal!: AbortSignal;
  let reject!: (error: unknown) => void;
  mocks.load.mockImplementation((value: AbortSignal) => {
    signal = value;
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  const { unmount } = renderHook(useSessionSettings);
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    reject(new Error("late offline"));
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(mocks.warning).not.toHaveBeenCalled();
});
