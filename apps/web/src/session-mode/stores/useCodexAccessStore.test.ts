import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("@session/services/apiAdapt/codex", () => ({ threadAccess: vi.fn() }));
import { threadAccess } from "@session/services/apiAdapt/codex";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import {
  assertCodexSendAccess,
  codexSendBlockReason,
  refreshCodexAccess,
  resetCodexAccessCache,
  startCodexAccessRuntimeSync,
  useCodexAccessStore,
} from "./useCodexAccessStore";
beforeEach(() => {
  resetCodexAccessCache();
  vi.mocked(threadAccess)
    .mockReset()
    .mockResolvedValue({ state: "owned", reason: "", generation: 1 });
});
afterEach(() => {
  resetCodexAccessCache();
  vi.useRealTimers();
});
it("always checks access for an uncached target, even at a zero clock", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.mocked(threadAccess).mockResolvedValueOnce({
    state: "external",
    reason: "occupied",
    generation: 1,
  });
  await expect(assertCodexSendAccess("a")).rejects.toThrow("其他客户端占用");
  expect(threadAccess).toHaveBeenCalledOnce();
});
it("merges concurrent read-only queries and does not notify subscribers for identical polls", async () => {
  const changed = vi.fn();
  const unsubscribe = useCodexAccessStore.subscribe(changed);
  try {
    await Promise.all([refreshCodexAccess("a"), refreshCodexAccess("a")]);
    expect(threadAccess).toHaveBeenCalledOnce();
    const state = useCodexAccessStore.getState();
    await refreshCodexAccess("a");
    expect(useCodexAccessStore.getState()).toBe(state);
    expect(changed).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(threadAccess)
        .mock.calls.every(([, release]) => release === false),
    ).toBe(true);
  } finally {
    unsubscribe();
  }
});
it.each(["readonly", "owned"] as const)(
  "permits an explicit send to the original %s thread",
  async (state) => {
    vi.mocked(threadAccess).mockResolvedValueOnce({
      state,
      reason: "",
      generation: 1,
    });
    await expect(assertCodexSendAccess("a")).resolves.toBeUndefined();
  },
);
it.each(["external", "releasing", "unknown"] as const)(
  "blocks %s before any writer request",
  async (state) => {
    vi.mocked(threadAccess).mockResolvedValueOnce({
      state,
      reason: "",
      generation: 1,
    });
    await expect(assertCodexSendAccess("a")).rejects.toThrow();
    expect(
      codexSendBlockReason(useCodexAccessStore.getState().entries.a),
    ).toBeTruthy();
  },
);
it("allows an older unsupported access endpoint but does not mistake a network failure for ownership", async () => {
  vi.mocked(threadAccess).mockRejectedValueOnce(
    new SessionApiError("unsupported", 404),
  );
  await expect(assertCodexSendAccess("a")).resolves.toBeUndefined();
  vi.mocked(threadAccess).mockRejectedValueOnce(new Error("offline"));
  await expect(assertCodexSendAccess("b")).rejects.toThrow("无法确认");
  expect(useCodexAccessStore.getState().entries.a).toEqual({
    unsupported: true,
  });
});
it("does not reuse a stale occupied result after release and drops inactive metadata", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.mocked(threadAccess).mockResolvedValueOnce({
    state: "external",
    reason: "occupied",
    generation: 1,
  });
  await refreshCodexAccess("a");
  vi.setSystemTime(16_000);
  await expect(assertCodexSendAccess("a")).resolves.toBeUndefined();
  vi.setSystemTime(80_000);
  await refreshCodexAccess("b");
  expect(useCodexAccessStore.getState().entries.a).toBeUndefined();
});
it("discards a pre-restart access response without overwriting a fresh generation", async () => {
  let resolve!: (value: any) => void;
  vi.mocked(threadAccess).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const stale = refreshCodexAccess("a");
  resetCodexAccessCache();
  await refreshCodexAccess("a");
  resolve({ state: "external", reason: "old runtime", generation: 1 });
  await stale;
  expect(useCodexAccessStore.getState().entries.a.access?.state).toBe("owned");
});
it("listens for runtime replacement only while the session lifecycle is active", () => {
  const stop = startCodexAccessRuntimeSync();
  useCodexAccessStore.setState({ entries: { a: { unsupported: true } } });
  window.dispatchEvent(new Event("session-runtime-restarted"));
  expect(useCodexAccessStore.getState().entries).toEqual({});
  stop();
  useCodexAccessStore.setState({ entries: { a: { unsupported: true } } });
  window.dispatchEvent(new Event("session-runtime-restarted"));
  expect(useCodexAccessStore.getState().entries).toEqual({
    a: { unsupported: true },
  });
});
