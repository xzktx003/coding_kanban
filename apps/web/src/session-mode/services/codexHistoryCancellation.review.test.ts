import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadRead: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
import { cancelCodexHistoryRead, codexService } from "./codexService";
import { enqueueSessionRead } from "./sessionReadQueue";
import { useCodexStore } from "../components/codex/stores/useCodexStore";

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
