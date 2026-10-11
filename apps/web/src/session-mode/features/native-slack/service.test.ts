import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeSlackTarget } from "@agent-orchestrator/shared";
import { createNativeSlackPreviewTransport } from "./service";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  subscriber: null as any,
  stop: vi.fn(),
  pairing: null as any,
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: mocks.post,
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => "https://fixture.invalid" + path,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (s: any) => {
    mocks.subscriber = s;
    return mocks.stop;
  },
}));
vi.mock("@session/stores/usePairingStore", () => ({
  usePairingStore: {
    subscribe: (s: any) => {
      mocks.pairing = s;
      return () => {};
    },
  },
}));
const href = "https://team.slack.com/team/U123",
  target = nativeSlackTarget(href)!;
const scope = { identity: "a".repeat(64), token: "b".repeat(64) };
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscriber = null;
});
afterEach(() => vi.useRealTimers());
it("prepares a fixed target and receives only a bounded matching HTTP projection", async () => {
  mocks.post.mockResolvedValueOnce({ context: scope }).mockResolvedValueOnce({
    identity: scope.identity,
    data: { status: "ready", title: "Alice", description: "Engineer" },
  });
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal,
    check = vi.fn();
  expect(await host.prepare!(target, signal, check)).toBe(scope.identity);
  expect(await host.read(target, signal, check)).toEqual({
    status: "ready",
    title: "Alice",
    description: "Engineer",
  });
  expect(mocks.post.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ["/api/codex/mcp/slack-preview/context", { href }],
    ["/api/codex/mcp/slack-preview/read", { href, contextToken: scope.token }],
  ]);
  expect(check).toHaveBeenCalledTimes(4);
});
it("old runtimes and missing connections remain unavailable for one minute without calling any tool", async () => {
  vi.useFakeTimers();
  mocks.post.mockRejectedValue(new Error("404 route not present"));
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal;
  expect(await host.prepare!(target, signal, () => {})).toBeNull();
  expect(await host.prepare!(target, signal, () => {})).toBeNull();
  expect(mocks.post).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_001);
  await host.prepare!(target, signal, () => {});
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
it("account events invalidate an in-flight read and never accept its late fields", async () => {
  const reply = deferred<unknown>();
  mocks.post
    .mockResolvedValueOnce({ context: scope })
    .mockImplementationOnce(() => reply.promise);
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal,
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  await host.prepare!(target, signal, () => {});
  const work = host.read(target, signal, () => {});
  mocks.subscriber.onEvent({
    event: "codex:notification",
    payload: { method: "account/updated" },
  });
  reply.resolve({
    identity: scope.identity,
    data: { status: "ready", title: "Old account", description: null },
  });
  await expect(work).rejects.toThrow("connection changed");
  expect(host.identity(target)).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
  stop();
  expect(mocks.stop).toHaveBeenCalledOnce();
});
it("directory events revalidate identity without rereading unchanged tool data", async () => {
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal,
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  mocks.post.mockResolvedValue({ context: scope });
  await host.prepare!(target, signal, () => {});
  mocks.subscriber.onEvent({
    event: "codex:notification",
    payload: { method: "mcpServer/startupStatus/updated" },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(notify).not.toHaveBeenCalled();
  expect(mocks.post.mock.calls.every((c) => c[0].endsWith("/context"))).toBe(
    true,
  );
  mocks.post.mockResolvedValue({
    context: { ...scope, identity: "c".repeat(64) },
  });
  mocks.subscriber.onEvent({
    event: "codex:notification",
    payload: { method: "app/list/updated" },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  stop();
});
it("a newly available connector is discovered after a negative context without waiting for stale expiry", async () => {
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal,
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  mocks.post.mockResolvedValueOnce({ context: null });
  expect(await host.prepare!(target, signal, () => {})).toBeNull();
  mocks.post.mockResolvedValue({ context: scope });
  mocks.subscriber.onEvent({
    event: "codex:notification",
    payload: { method: "app/list/updated" },
  });
  await vi.waitFor(() => expect(host.identity(target)).toBe(scope.identity));
  expect(notify).toHaveBeenCalledOnce();
  expect(mocks.post.mock.calls.every((c) => c[0].endsWith("/context"))).toBe(
    true,
  );
  stop();
});
it("pairing token changes invalidate identity even at the same host and port", async () => {
  const host = createNativeSlackPreviewTransport(href),
    signal = new AbortController().signal,
    notify = vi.fn(),
    stop = host.subscribe!(notify);
  mocks.post.mockResolvedValue({ context: scope });
  await host.prepare!(target, signal, () => {});
  const desktop = { host: "fixture", port: 1, token: "old" };
  mocks.pairing(
    { selectedHost: "fixture", desktops: [{ ...desktop, token: "new" }] },
    { selectedHost: "fixture", desktops: [desktop] },
  );
  expect(host.identity(target)).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
  stop();
});
