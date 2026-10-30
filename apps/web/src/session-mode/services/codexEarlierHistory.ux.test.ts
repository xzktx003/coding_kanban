import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadStart: vi.fn(),
  gitCreateWorktree: vi.fn(),
  threadRead: vi.fn(),
  threadRollback: vi.fn(),
  turnInterrupt: vi.fn(),
  turnStart: vi.fn(),
}));
vi.mock("./apiAdapt/codex", () => api);
import {
  cancelCodexHistoryRead,
  codexService,
  resetCodexRuntimeState,
} from "./codexService";
import { invalidateCodexOperationScope } from "./codexOperationScope";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { useCodexStore } from "../components/codex/stores/useCodexStore";

function seedLoadedThread(id: string) {
  useCodexStore.setState({
    currentThreadId: id,
    activeThreadIds: [id],
    events: { [id]: [] },
    threads: [],
    historyLoadedMap: { [id]: true },
    historyLoadingMap: {},
    historyErrorMap: {},
    turnTimingMap: {},
    threadStatusMap: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionSyncStore.setState({
    recovering: {},
    checking: {},
    cursors: {},
    trimmedHistoryAnchors: {},
    earlierLoading: {},
    earlierErrors: {},
    connection: "connected",
  });
});

it("a cancelled earlier read does not surface a failure on the paging control", async () => {
  const id = "earlier-cancelled";
  let transport!: AbortSignal;
  api.threadRead.mockImplementationOnce((_params, options) => {
    transport = options.signal;
    return new Promise(() => {}); // The transport never settles on its own.
  });
  seedLoadedThread(id);
  useSessionSyncStore.setState({ cursors: { [id]: "before-50" } });

  const earlier = codexService.loadEarlierHistory(id);
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  // The retention budget cancels in-flight reads of an observed thread.
  cancelCodexHistoryRead(id);
  await earlier;

  const state = useSessionSyncStore.getState();
  expect(transport.aborted).toBe(true);
  expect(state.earlierLoading[id]).toBe(false);
  // A cancellation is not a user-visible paging failure: keeping the error set
  // blocks the scroll trigger forever and only shows "加载失败，可重试".
  expect(state.earlierErrors[id] ?? "").toBe("");
  expect(state.cursors[id]).toBe("before-50");

  api.threadRead.mockResolvedValueOnce({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "older" },
  });
  await codexService.loadEarlierHistory(id);
  expect(api.threadRead).toHaveBeenCalledTimes(2);
  expect(useSessionSyncStore.getState().cursors[id]).toBe("older");
});

it.each([
  new Error("history unavailable"),
  Object.assign(new Error("Read timed out"), { name: "TimeoutError" }),
  new Error("This operation was aborted"),
])("a failed earlier page (%s) keeps its reason and clears after a successful retry", async (failure) => {
  const id = "earlier-retry";
  seedLoadedThread(id);
  useSessionSyncStore.setState({ cursors: { [id]: "before-50" } });
  api.threadRead.mockRejectedValueOnce(failure);

  await codexService.loadEarlierHistory(id);
  expect(useSessionSyncStore.getState().earlierErrors[id]).toBe(
    failure.message,
  );

  api.threadRead.mockResolvedValueOnce({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "older" },
  });
  await codexService.loadEarlierHistory(id);
  const state = useSessionSyncStore.getState();
  expect(state.earlierErrors[id] ?? "").toBe("");
  expect(state.cursors[id]).toBe("older");
});

it("a runtime/account change during an earlier read is not reported as a paging failure", async () => {
  const id = "earlier-scope";
  let finish!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  seedLoadedThread(id);
  useSessionSyncStore.setState({ cursors: { [id]: "before-50" } });

  const earlier = codexService.loadEarlierHistory(id);
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  // A reconnect or account notification revokes the snapshot mid-read.
  invalidateCodexOperationScope();
  finish({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "older" },
  });
  await earlier;

  const state = useSessionSyncStore.getState();
  expect(state.earlierLoading[id]).toBe(false);
  // The reader will re-read the current page; a transient revocation must not
  // leave the retry banner latched and the scroll trigger disabled.
  expect(state.earlierErrors[id] ?? "").toBe("");
  expect(state.cursors[id]).toBe("before-50");
  expect(useCodexStore.getState().events[id]).toEqual([]);
});

it("a recovery-anchor page is still requested when a background read is already running", async () => {
  const id = "earlier-anchor-inflight";
  let finish!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  api.threadRead.mockResolvedValueOnce({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "older" },
  });
  seedLoadedThread(id);
  // Memory reclamation left only a recovery anchor, with no opaque cursor.
  useSessionSyncStore.setState({
    cursors: {},
    trimmedHistoryAnchors: { [id]: "turn-0" },
  });

  const recent = codexService
    .loadThreadHistory(id, undefined, { background: true, recent: true })
    .catch(() => undefined);
  // The anchor page is a different page than the running recent check.
  // Reusing that response silently drops the request: the older turns never
  // return and the anchor stays, so the paging control looks broken.
  const anchored = codexService
    .loadThreadHistory(id, undefined, {
      background: true,
      recent: true,
      afterTurnId: "turn-0",
    })
    .catch(() => undefined);
  finish({ thread: { id, turns: [] } });
  await Promise.all([recent, anchored]);

  expect(api.threadRead).toHaveBeenCalledWith(
    { threadId: id, recent: true, afterTurnId: "turn-0" },
    expect.objectContaining({ suppressToast: true }),
  );
  expect(
    useSessionSyncStore.getState().trimmedHistoryAnchors[id],
  ).toBeUndefined();
});

it("a stale earlier read cannot clear a newer page's loading flag", async () => {
  const id = "earlier-stale";
  let finishFirst!: (value: unknown) => void;
  let finishSecond!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSecond = resolve;
      }),
  );
  seedLoadedThread(id);
  useSessionSyncStore.setState({ cursors: { [id]: "before-50" } });

  const first = codexService.loadEarlierHistory(id);
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  expect(useSessionSyncStore.getState().earlierLoading[id]).toBe(true);
  resetCodexRuntimeState();
  const second = codexService.loadEarlierHistory(id);
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledTimes(2));
  await first;
  expect(useSessionSyncStore.getState().earlierLoading[id]).toBe(true);
  expect(useSessionSyncStore.getState().earlierErrors[id] ?? "").toBe("");

  // Even an abort-ignoring old transport may resolve after its replacement.
  finishFirst({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "stale-older" },
  });
  await Promise.resolve();
  expect(useSessionSyncStore.getState().earlierLoading[id]).toBe(true);
  expect(useSessionSyncStore.getState().cursors[id]).toBe("before-50");
  finishSecond({
    thread: { id, turns: [] },
    historyPage: { earlier: true, nextCursor: "older" },
  });
  await second;
  expect(useSessionSyncStore.getState().earlierLoading[id]).toBe(false);
  expect(useSessionSyncStore.getState().cursors[id]).toBe("older");
});
