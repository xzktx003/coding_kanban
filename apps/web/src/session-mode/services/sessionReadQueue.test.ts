import { afterEach, expect, it, vi } from "vitest";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";

afterEach(() => vi.useRealTimers());
it.each(["recent", "history"] as const)(
  "reserves %s capacity for explicit reads while every background job still completes",
  async (lane) => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const background = ["b0", "b1", "b2", "b3"].map((key) =>
      enqueueSessionRead(
        lane,
        `reserve:${key}`,
        () => {
          started.push(key);
          return new Promise<void>((resolve) => releases.push(resolve));
        },
        undefined,
        "background",
      ),
    );
    const explicit = enqueueSessionRead(
      lane,
      "reserve:visible",
      async () => {
        started.push("visible");
      },
      undefined,
      "interactive",
    );
    try {
      expect(started).toEqual(["b0", "visible"]);
    } finally {
      // Drain even on red so failed assertions do not leave a shared worker held.
      for (let i = 0; i < 8; i++) {
        releases.splice(0).forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await Promise.all([...background, explicit]);
    }
    expect(started).toContain("b3");
  },
);
it("promotes a coalesced queued read without starting it twice", async () => {
  const releases: Array<() => void> = [];
  const start: string[] = [];
  const job = (key: string) => () => {
    start.push(key);
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  const reads = ["a", "b", "selected"].map((key) =>
    enqueueSessionRead(
      "recent",
      `promotion:${key}`,
      job(key),
      undefined,
      "background",
    ),
  );
  const joined = enqueueSessionRead(
    "recent",
    "promotion:selected",
    job("duplicate"),
    undefined,
    "interactive",
  );
  try {
    expect(start).toEqual(["a", "selected"]);
    await Promise.resolve();
  } finally {
    for (let i = 0; i < 4; i++) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([...reads, joined]);
  }
  expect(start).not.toContain("duplicate");
});
it("reserves one receipt slot while preserving the six-read total budget", async () => {
  const started = { recent: 0, history: 0, status: 0 };
  const releases: Array<() => void> = [];
  let finishing = false;
  const jobs = (["recent", "history", "status"] as const).flatMap((lane) =>
    Array.from({ length: 5 }, (_, index) =>
      enqueueSessionRead(lane, `budget:${lane}:${index}`, () => {
        started[lane]++;
        return finishing
          ? Promise.resolve()
          : new Promise<void>((resolve) => releases.push(resolve));
      }),
    ),
  );
  try {
    expect(started).toEqual({ recent: 3, history: 2, status: 1 });
    expect(releases).toHaveLength(6);
  } finally {
    finishing = true;
    releases.forEach((release) => release());
    await Promise.all(jobs);
  }
});
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
