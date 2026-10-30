import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadRead: vi.fn(),
  threadMetadata: vi.fn(),
  listThreads: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => api);
import {
  codexService,
  resetCodexRuntimeState,
} from "@session/services/codexService";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { enqueueSessionRead } from "./sessionReadQueue";
import type { Thread } from "@session/bindings/v2/Thread";
const source = {
  name: "fixture",
  host: "metadata-fixture.invalid",
  port: 45000,
  token: "old-fixture-token",
};
const makeThread = (id: string, cwd: string): Thread => ({
  id,
  extra: null,
  sessionId: id,
  forkedFromId: null,
  parentThreadId: null,
  cwd,
  name: "fixture",
  preview: "fixture",
  ephemeral: false,
  isPinned: false,
  historyMode: "paginated",
  createdAt: 1,
  updatedAt: 1,
  recencyAt: null,
  modelProvider: "fixture",
  path: null,
  cliVersion: "fixture",
  source: "vscode",
  status: { type: "idle" },
  canAcceptDirectInput: null,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  turns: [],
});
beforeEach(() => {
  resetCodexRuntimeState();
  for (const mock of Object.values(api)) mock.mockReset();
  useCodexStore.setState({
    currentThreadId: null,
    threads: [],
    events: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    threadListNextCursor: null,
  });
  usePairingStore.setState({ desktops: [source], selectedHost: source.host });
});
afterEach(() => {
  resetCodexRuntimeState();
  usePairingStore.setState({ desktops: [], selectedHost: null });
  vi.restoreAllMocks();
});
function changeSource(change: string) {
  usePairingStore.setState({
    desktops: [
      {
        ...source,
        ...(change === "token"
          ? { token: "new-fixture-token" }
          : { port: 45001 }),
      },
    ],
  });
}
it.each(["endpoint", "token"])(
  "rejects a held metadata result after %s changes while account confirmation is pending",
  async (change) => {
    const id = `metadata-source-${change}`,
      safe = makeThread(id, "/current-safe");
    useCodexStore.setState({ currentThreadId: id, threads: [safe] });
    api.threadRead.mockResolvedValue({
      thread: safe,
      historyPage: { nextCursor: null, earlier: false },
    });
    let release!: (value: unknown) => void;
    api.threadMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await codexService.loadThreadHistory(id, undefined, { recent: true });
    await vi.waitFor(() => expect(api.threadMetadata).toHaveBeenCalledOnce());
    changeSource(change);
    release({
      thread: makeThread(id, "/retired-private-source-A"),
      model: "retired-source-model",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useCodexStore.getState().threads.find((t) => t.id === id)?.cwd).toBe(
      "/current-safe",
    );
  },
);
it.each(["endpoint", "token"])(
  "rejects a held thread list after %s changes while account confirmation is pending",
  async (change) => {
    const safe = makeThread("safe-list", "/current-safe");
    useCodexStore.setState({ threads: [safe] });
    let release!: (value: unknown) => void;
    api.listThreads.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = codexService.loadThreads("/fixture");
    changeSource(change);
    release({
      data: [makeThread("retired-list", "/retired-private-source-A")],
      nextCursor: "retired-source-cursor",
    });
    await pending;
    expect(useCodexStore.getState().threads.map((t) => t.id)).toEqual([
      safe.id,
    ]);
    expect(useCodexStore.getState().threadListNextCursor).toBe(null);
  },
);

it("cannot revive old metadata after the source changes away and back", async () => {
  const id = "metadata-returned-values",
    safe = makeThread(id, "/current-safe");
  useCodexStore.setState({ currentThreadId: id, threads: [safe] });
  api.threadRead.mockResolvedValue({
    thread: safe,
    historyPage: { nextCursor: null, earlier: false },
  });
  let release!: (value: unknown) => void;
  api.threadMetadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await codexService.loadThreadHistory(id, undefined, { recent: true });
  await vi.waitFor(() => expect(api.threadMetadata).toHaveBeenCalledOnce());
  changeSource("token");
  usePairingStore.setState({ desktops: [source], selectedHost: source.host });
  release({ thread: makeThread(id, "/retired-private-source-A") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useCodexStore.getState().threads.find((t) => t.id === id)?.cwd).toBe(
    "/current-safe",
  );
});

it("cannot revive an old list after the source changes away and back", async () => {
  const safe = makeThread("list-returned-values", "/current-safe");
  useCodexStore.setState({ threads: [safe] });
  let release!: (value: unknown) => void;
  api.listThreads.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = codexService.loadThreads("/fixture");
  changeSource("token");
  usePairingStore.setState({ desktops: [source], selectedHost: source.host });
  release({
    data: [makeThread("retired-list", "/old")],
    nextCursor: "old-cursor",
  });
  await pending;
  expect(useCodexStore.getState().threads.map((t) => t.id)).toEqual([safe.id]);
});

it.each(["success", "failure"])(
  "keeps the latest project's list and cursor when an older same-source read finishes with %s",
  async (outcome) => {
    let resolveOld!: (value: unknown) => void,
      rejectOld!: (error: unknown) => void;
    api.listThreads.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveOld = resolve;
          rejectOld = reject;
        }),
    );
    const old = codexService.loadThreads("/project-A");
    api.listThreads.mockResolvedValueOnce({
      data: [makeThread("project-B", "/project-B")],
      nextCursor: "cursor-B",
    });
    await codexService.loadThreads("/project-B");
    if (outcome === "success")
      resolveOld({
        data: [makeThread("project-A", "/project-A")],
        nextCursor: "cursor-A",
      });
    else rejectOld(new Error("retired source failed"));
    await old;
    expect(useCodexStore.getState().threads.map((t) => t.id)).toEqual([
      "project-B",
    ]);
    expect(useCodexStore.getState().threadListNextCursor).toBe("cursor-B");
  },
);

it("does not let an old endpoint's failure clear a new endpoint's successful list", async () => {
  let rejectOld!: (error: unknown) => void;
  api.listThreads.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  const old = codexService.loadThreads("/fixture");
  changeSource("endpoint");
  api.listThreads.mockResolvedValueOnce({
    data: [makeThread("new-source", "/new")],
    nextCursor: "new-cursor",
  });
  await codexService.loadThreads("/fixture");
  rejectOld(new Error("retired endpoint failed"));
  await old;
  expect(useCodexStore.getState().threads.map((t) => t.id)).toEqual([
    "new-source",
  ]);
  expect(useCodexStore.getState().threadListNextCursor).toBe("new-cursor");
});

it("shares current metadata demands while a new source starts its own read before the old reply", async () => {
  const id = "metadata-demand-source",
    safe = makeThread(id, "/safe");
  useCodexStore.setState({ currentThreadId: id, threads: [safe] });
  api.threadRead.mockResolvedValue({
    thread: safe,
    historyPage: { nextCursor: null, earlier: false },
  });
  let releaseOld!: (value: unknown) => void;
  api.threadMetadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseOld = resolve;
      }),
  );
  try {
    await codexService.loadThreadHistory(id, undefined, { recent: true });
    await vi.waitFor(() => expect(api.threadMetadata).toHaveBeenCalledOnce());
    await codexService.loadThreadHistory(id, undefined, { recent: true });
    expect(api.threadMetadata).toHaveBeenCalledOnce();
    changeSource("token");
    api.threadMetadata.mockResolvedValueOnce({
      thread: makeThread(id, "/new-source"),
    });
    await codexService.loadThreadHistory(id, undefined, { recent: true });
    await vi.waitFor(() => expect(api.threadMetadata).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        useCodexStore.getState().threads.find((t) => t.id === id)?.cwd,
      ).toBe("/new-source"),
    );
    releaseOld({ thread: makeThread(id, "/old-source") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useCodexStore.getState().threads.find((t) => t.id === id)?.cwd).toBe(
      "/new-source",
    );
  } finally {
    releaseOld?.({ thread: safe });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

it("does not dispatch queued old-source metadata through the newly selected endpoint", async () => {
  const blockers: Array<() => void> = [];
  const pending = [0, 1].map((index) =>
    enqueueSessionRead(
      "history",
      `metadata-source-blocker-${index}`,
      () => new Promise<void>((resolve) => blockers.push(resolve)),
    ),
  );
  const id = "queued-metadata-source",
    safe = makeThread(id, "/safe");
  useCodexStore.setState({ currentThreadId: id, threads: [safe] });
  api.threadRead.mockResolvedValue({
    thread: safe,
    historyPage: { nextCursor: null, earlier: false },
  });
  api.threadMetadata.mockResolvedValue({
    thread: makeThread(id, "/wrong-endpoint"),
  });
  try {
    await codexService.loadThreadHistory(id, undefined, { recent: true });
    expect(api.threadMetadata).not.toHaveBeenCalled();
    changeSource("endpoint");
  } finally {
    for (const release of blockers) release();
    await Promise.all(pending);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.threadMetadata).not.toHaveBeenCalled();
});

it("releases pairing subscriptions after metadata/list settlement and revocation", async () => {
  let active = 0;
  const subscribe = usePairingStore.subscribe;
  vi.spyOn(usePairingStore, "subscribe").mockImplementation((listener) => {
    active++;
    const stop = subscribe(listener);
    return () => {
      active--;
      stop();
    };
  });
  const id = "metadata-source-disposal",
    safe = makeThread(id, "/safe");
  useCodexStore.setState({ currentThreadId: id, threads: [safe] });
  api.threadRead.mockResolvedValue({
    thread: safe,
    historyPage: { nextCursor: null, earlier: false },
  });
  api.threadMetadata.mockResolvedValue({ thread: safe });
  await codexService.loadThreadHistory(id, undefined, { recent: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(active).toBe(0);
  let release!: (value: unknown) => void;
  api.listThreads.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const list = codexService.loadThreads("/fixture");
  changeSource("token");
  release({ data: [safe], nextCursor: null });
  await list;
  expect(active).toBe(0);
});
