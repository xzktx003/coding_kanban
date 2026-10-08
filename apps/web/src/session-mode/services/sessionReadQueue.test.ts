import { afterEach, expect, it, vi } from "vitest";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";

afterEach(() => vi.useRealTimers());
it("slow complete histories cannot occupy recent-message workers", async () => {
  const release: Array<() => void> = [];
  const slow = ["a", "b"].map((key) =>
    enqueueSessionRead(
      "history",
      key,
      () => new Promise<void>((r) => release.push(r)),
    ),
  );
  await Promise.resolve();
  expect(release).toHaveLength(2);
  await expect(
    enqueueSessionRead("recent", "c", async () => "fresh"),
  ).resolves.toBe("fresh");
  release.forEach((r) => r());
  await Promise.all(slow);
});
it("releases a timed-out worker even when the transport ignores cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = readWithDeadline(
    (signal) => {
      expect(signal.aborted).toBe(false);
      return new Promise<void>(() => {});
    },
    5000,
    controller.signal,
  );
  const rejected = expect(read).rejects.toThrow(/timed out/i);
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
});
it("coalesces the same reader and rejects cancellation before a queued read starts", async () => {
  let release!: () => void;
  const work = vi.fn(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const first = enqueueSessionRead("recent", "same", work);
  const second = enqueueSessionRead("recent", "same", work);
  await Promise.resolve();
  expect(work).toHaveBeenCalledOnce();
  release();
  await Promise.all([first, second]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    readWithDeadline(work, 5000, controller.signal),
  ).rejects.toThrow();
  expect(work).toHaveBeenCalledOnce();
});
