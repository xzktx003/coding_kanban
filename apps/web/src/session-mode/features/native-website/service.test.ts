import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createNativeWebsitePreviewTransport } from "./service";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  origin: "https://fixture.invalid",
  listeners: new Set<any>(),
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: mocks.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (p: string) => mocks.origin + p,
}));
vi.mock("@session/stores/usePairingStore", () => ({
  usePairingStore: {
    subscribe: (fn: any) => {
      mocks.listeners.add(fn);
      return () => mocks.listeners.delete(fn);
    },
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.post.mockReset();
  mocks.origin = "https://fixture.invalid";
});
afterEach(() => vi.useRealTimers());
const data = {
  status: "ready",
  title: "Title",
  description: null,
  image: null,
};
it("reads only the captured hash-free URL and rejects a changed target without HTTP", async () => {
  mocks.post.mockResolvedValue(data);
  const host = createNativeWebsitePreviewTransport(
      "https://example.com/a#fragment",
    ),
    stop = host.subscribe!(vi.fn()),
    check = vi.fn();
  expect(
    await host.read(
      "https://example.com/a",
      new AbortController().signal,
      check,
    ),
  ).toEqual(data);
  expect(mocks.post.mock.calls[0].slice(0, 2)).toEqual([
    "/api/codex/website-preview",
    { url: "https://example.com/a" },
  ]);
  await expect(
    host.read("https://other.example/a", new AbortController().signal, check),
  ).rejects.toThrow("target changed");
  expect(mocks.post).toHaveBeenCalledOnce();
  stop();
});
it("discarding a late old-host response does not publish it or silently reread", async () => {
  let finish!: (value: any) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const host = createNativeWebsitePreviewTransport("https://example.com/a"),
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  const work = host.read(
    "https://example.com/a",
    new AbortController().signal,
    () => {},
  );
  for (const fn of mocks.listeners)
    fn(
      { selectedHost: "a", desktops: [{ host: "a", port: 42, token: "new" }] },
      { selectedHost: "a", desktops: [{ host: "a", port: 42, token: "old" }] },
    );
  finish(data);
  await expect(work).rejects.toThrow("host changed");
  expect(notify).toHaveBeenCalledWith({ reload: false });
  expect(mocks.post).toHaveBeenCalledOnce();
  stop();
});
it("closed owners are evicted at 32 entries and release their timer on unsubscribe", async () => {
  mocks.post.mockResolvedValue(data);
  const owners = Array.from({ length: 33 }, (_, i) => {
    const href = `https://example.com/${i}`,
      host = createNativeWebsitePreviewTransport(href),
      notify = vi.fn();
    return { href, host, notify, stop: host.subscribe!(notify) };
  });
  try {
    for (const owner of owners)
      await owner.host.read(owner.href, new AbortController().signal, () => {});
    expect(owners[0]!.notify).toHaveBeenCalledWith({ reload: false });
    expect(owners[1]!.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(owners[1]!.notify).toHaveBeenCalledWith({ reload: false });
    expect(mocks.post).toHaveBeenCalledTimes(33);
  } finally {
    for (const owner of owners) owner.stop();
  }
  expect(vi.getTimerCount()).toBe(0);
});
it("large image owners cannot retain more than the 24 MiB encoded-body budget", async () => {
  mocks.post.mockResolvedValue({
    ...data,
    image: {
      dataUrl: "data:image/png;base64," + "A".repeat(2_700_000),
      width: 1,
      height: 1,
    },
  });
  const owners = Array.from({ length: 5 }, (_, i) => {
    const href = `https://example.com/large-${i}`,
      host = createNativeWebsitePreviewTransport(href),
      notify = vi.fn();
    return { href, host, notify, stop: host.subscribe!(notify) };
  });
  try {
    for (const o of owners)
      await o.host.read(o.href, new AbortController().signal, () => {});
    expect(owners[0]!.notify).toHaveBeenCalledWith({ reload: false });
    expect(owners[1]!.notify).not.toHaveBeenCalled();
  } finally {
    for (const o of owners) o.stop();
  }
});

it("an open card is not retired by the closed-card GC timer; its grace period starts after closing", async () => {
  mocks.post.mockResolvedValue(data);
  const host = createNativeWebsitePreviewTransport(
      "https://example.com/visible",
    ),
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  try {
    host.setVisible!(true);
    await host.read(
      "https://example.com/visible",
      new AbortController().signal,
      () => {},
    );
    await vi.advanceTimersByTimeAsync(600_000);
    expect(notify).not.toHaveBeenCalled();
    host.setVisible!(false);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledWith({ reload: false });
  } finally {
    stop();
  }
});

it("the current visible image is preserved while older closed owners are evicted within the same byte budget", async () => {
  mocks.post.mockResolvedValue({
    ...data,
    image: {
      dataUrl: "data:image/png;base64," + "A".repeat(2_700_000),
      width: 1,
      height: 1,
    },
  });
  const owners = Array.from({ length: 6 }, (_, i) => {
    const href = `https://example.com/priority-${i}`,
      host = createNativeWebsitePreviewTransport(href),
      notify = vi.fn();
    return { href, host, notify, stop: host.subscribe!(notify) };
  });
  try {
    owners[0]!.host.setVisible!(true);
    for (const o of owners)
      await o.host.read(o.href, new AbortController().signal, () => {});
    expect(owners[0]!.notify).not.toHaveBeenCalled();
    expect(owners[1]!.notify).toHaveBeenCalledWith({ reload: false });
    expect(owners[2]!.notify).toHaveBeenCalledWith({ reload: false });
  } finally {
    for (const o of owners) o.stop();
  }
});
