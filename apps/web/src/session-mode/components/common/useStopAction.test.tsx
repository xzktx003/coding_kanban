import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useStopAction } from "./useStopAction";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";

it("blocks duplicate stops until completion and scopes pending state to the task", async () => {
  let resolve!: () => void;
  const stop = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const hook = renderHook(
    ({ key, running }) => useStopAction(key, running, stop),
    {
      initialProps: { key: "a:turn-1", running: true },
    },
  );
  let request!: Promise<void>;
  act(() => {
    request = hook.result.current.requestStop();
    void hook.result.current.requestStop();
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(hook.result.current.stopping).toBe(true);
  hook.rerender({ key: "b:turn-2", running: true });
  expect(hook.result.current.stopping).toBe(false);
  await act(async () => {
    resolve();
    await request;
  });
  hook.rerender({ key: "a:turn-1", running: true });
  expect(hook.result.current.stopping).toBe(true);
  hook.rerender({ key: "a:turn-1", running: false });
  await waitFor(() => expect(hook.result.current.stopping).toBe(false));
});
it("reports failure and permits retry without hiding the stop button", async () => {
  const stop = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  const hook = renderHook(() => useStopAction("a", true, stop));
  await act(async () => {
    await hook.result.current.requestStop();
  });
  expect(toast.error).toHaveBeenCalledWith("停止失败：offline");
  expect(hook.result.current.stopping).toBe(false);
  await act(async () => {
    await hook.result.current.requestStop();
  });
  expect(stop).toHaveBeenCalledTimes(2);
});
