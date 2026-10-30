import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadRead: vi.fn(),
}));
vi.mock("./apiAdapt/codex", () => api);
import { cancelCodexHistoryRead, codexService } from "./codexService";
import { enqueueSessionRead } from "./sessionReadQueue";
import { useCodexStore } from "../components/codex/stores/useCodexStore";

it("a cancelled startup selection does not publish a history failure or error log",async()=>{
  const id="cancelled-startup-selection";
  api.threadRead.mockRejectedValueOnce(new DOMException("Selection was replaced","AbortError"));
  const errors=vi.spyOn(console,"error").mockImplementation(()=>{});
  try {
    await expect(codexService.setCurrentThread(id)).resolves.toBeUndefined();
    expect(useCodexStore.getState().historyErrorMap[id]).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  }finally{errors.mockRestore();api.threadRead.mockReset();cancelCodexHistoryRead(id);}
});

it("immediately restores an actively cancelled history without joining its obsolete aborted request", async () => {
  const id = "review-active-cancel-and-immediate-reopen";
  api.threadRead.mockImplementationOnce(() => new Promise(() => {}));
  api.threadRead.mockResolvedValueOnce({ thread: { id, turns: [] } });
  const old = codexService.loadThreadHistory(id, undefined, { recent: true });
  const oldOutcome = old.catch(() => undefined);
  expect(api.threadRead).toHaveBeenCalledOnce();
  cancelCodexHistoryRead(id);
  // No yield: a close/reopen or visibility restore can occur in this same turn.
  const fresh = codexService.loadThreadHistory(id, undefined, { recent: true });
  try {
    await expect(fresh).resolves.toBeUndefined();
    expect(api.threadRead).toHaveBeenCalledTimes(2);
    expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true);
    expect(useCodexStore.getState().historyErrorMap[id]).toBeUndefined();
  } finally {
    await oldOutcome;
    await fresh.catch(() => undefined);
  }
});

it("detaches cancelled active dedup identity without releasing admission or deleting the new same-key read", async () => {
  const controller = new AbortController();
  let releaseOld!: () => void;
  let releaseFresh!: () => void;
  const releaseOther: Array<() => void> = [];
  const key = "review-active-identity";
  const old = enqueueSessionRead(
    "recent",
    key,
    () =>
      new Promise<void>((resolve) => {
        releaseOld = resolve;
      }),
    controller.signal,
  );
  const blockers = [0, 1].map((index) =>
    enqueueSessionRead(
      "recent",
      `${key}:blocker:${index}`,
      () => new Promise<void>((resolve) => releaseOther.push(resolve)),
    ),
  );
  controller.abort();
  const freshRun = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseFresh = resolve;
      }),
  );
  const fresh = enqueueSessionRead("recent", key, freshRun);
  try {
    expect(fresh).not.toBe(old);
    expect(freshRun).not.toHaveBeenCalled();
    releaseOld();
    await vi.waitFor(() => expect(freshRun).toHaveBeenCalledOnce());
    const unrelatedRun = vi.fn(async () => undefined);
    const duplicate = enqueueSessionRead("recent", key, unrelatedRun);
    expect(duplicate).toBe(fresh);
    expect(unrelatedRun).not.toHaveBeenCalled();
    releaseFresh();
    await fresh;
  } finally {
    releaseOld();
    releaseOther.forEach((resolve) => resolve());
    releaseFresh?.();
    await Promise.allSettled([old, fresh, ...blockers]);
  }
});

it("one consumer cancelling a shared history does not abort the remaining view", async () => {
  api.threadRead.mockClear();
  const id = "shared-consumer-cancel";
  let release!: (value: unknown) => void;
  let transport!: AbortSignal;
  api.threadRead.mockImplementationOnce((_params, options) => {
    transport = options.signal;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const scheduler = new AbortController();
  const background = codexService.loadThreadHistory(id, undefined, {
    recent: true,
    background: true,
    signal: scheduler.signal,
  });
  const cancelled = expect(background).rejects.toThrow(/abort/i);
  const visible = codexService.loadThreadHistory(id, undefined, {
    recent: true,
  });
  scheduler.abort();
  await cancelled;
  expect(transport.aborted).toBe(false);
  release({ thread: { id, turns: [] } });
  await visible;
  expect(api.threadRead).toHaveBeenCalledOnce();
  expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true);
});

it("the last consumer cancellation detaches immediately so a reopen gets a fresh reader", async () => {
  api.threadRead.mockClear();
  const id = "shared-consumer-last-cancel";
  let signal!: AbortSignal;
  api.threadRead.mockImplementationOnce((_params, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  api.threadRead.mockResolvedValueOnce({ thread: { id, turns: [] } });
  const controller = new AbortController();
  const old = codexService.loadThreadHistory(id, undefined, {
    recent: true,
    signal: controller.signal,
  });
  const cancelled = expect(old).rejects.toThrow(/abort/i);
  controller.abort();
  const fresh = codexService.loadThreadHistory(id, undefined, { recent: true });
  await cancelled;
  await fresh;
  expect(signal.aborted).toBe(true);
  expect(api.threadRead).toHaveBeenCalledTimes(2);
  expect(useCodexStore.getState().historyErrorMap[id]).toBeUndefined();
});

it("does not merge a full read into an in-flight recent-page read", async () => {
  api.threadRead.mockClear();
  const id = "distinct-history-projections";
  let release!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  api.threadRead.mockResolvedValueOnce({ thread: { id, turns: [] } });
  const recent = codexService.loadThreadHistory(id, undefined, {
    recent: true,
  });
  const full = codexService.loadThreadHistory(id);
  expect(api.threadRead).toHaveBeenCalledTimes(1);
  release({ thread: { id, turns: [] } });
  await Promise.all([recent, full]);
  expect(api.threadRead).toHaveBeenCalledTimes(2);
  expect(api.threadRead.mock.calls[0][0]).toEqual({
    threadId: id,
    recent: true,
  });
  expect(api.threadRead.mock.calls[1][0]).toEqual({ threadId: id });
});

it("coalesces matching later consumers again after a different projection settles", async () => {
  api.threadRead.mockClear();
  const id = "waiting-history-projection-consumers";
  let releaseRecent!: (value: unknown) => void;
  let releaseFull!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseRecent = resolve;
      }),
  );
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseFull = resolve;
      }),
  );
  const recent = codexService.loadThreadHistory(id, undefined, {
    recent: true,
  });
  const first = codexService.loadThreadHistory(id);
  const second = codexService.loadThreadHistory(id);
  const response = { thread: { id, turns: [] } };
  releaseRecent(response);
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledTimes(2));
  releaseFull(response);
  await Promise.all([recent, first, second]);
  expect(api.threadRead).toHaveBeenCalledTimes(2);
});
