import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ threadRead: vi.fn() }));
vi.mock("./apiAdapt/codex", () => api);
import { codexService, resetCodexRuntimeState } from "./codexService";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { usePairingStore } from "../stores/usePairingStore";
import { HistoryReadScopeChangedError } from "./HistoryReadScopeChangedError";
const source = {
  name: "fixture",
  host: "history-fixture.invalid",
  port: 45000,
  token: "old-fixture-token",
};
const page = (id: string, text: string) => ({
  thread: {
    id,
    turns: [
      {
        id: "turn",
        status: "completed",
        startedAt: 1,
        durationMs: 10,
        items: [{ type: "agentMessage", id: "reply", text }],
      },
    ],
  },
  historyPage: { nextCursor: null, earlier: false },
});
beforeEach(() => {
  resetCodexRuntimeState();
  api.threadRead.mockReset();
  useCodexStore.setState({
    currentThreadId: null,
    events: {},
    threads: [],
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
  });
  usePairingStore.setState({ desktops: [source], selectedHost: source.host });
});
afterEach(() => usePairingStore.setState({ desktops: [], selectedHost: null }));
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
  "does not publish a held %s history body or mark its revision synchronized",
  async (change) => {
    const id = `old-source-${change}`;
    let release!: (value: unknown) => void;
    api.threadRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = codexService.loadThreadHistory(id, undefined, {
      recent: true,
      background: true,
      reportScopeChanges: true,
    });
    const outcome = pending.catch((error) => error);
    expect(api.threadRead).toHaveBeenCalledOnce();
    changeSource(change);
    release(page(id, "retired source body"));
    expect(await outcome).toBeInstanceOf(HistoryReadScopeChangedError);
    expect(useCodexStore.getState().events[id]).toBeUndefined();
    expect(useCodexStore.getState().historyLoadedMap[id]).not.toBe(true);
    expect(useCodexStore.getState().historyErrorMap[id]).toBeUndefined();
  },
);

it.each(["endpoint", "token"])(
  "never joins an obsolete %s read when the new source requests the same thread/page",
  async (change) => {
    const id = `dedupe-source-${change}`;
    let release!: (value: unknown) => void;
    api.threadRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    api.threadRead.mockResolvedValueOnce(page(id, "current source body"));
    const old = codexService
      .loadThreadHistory(id, undefined, {
        recent: true,
        background: true,
        reportScopeChanges: true,
      })
      .catch((error) => error);
    expect(api.threadRead).toHaveBeenCalledOnce();
    changeSource(change);
    const fresh = codexService.loadThreadHistory(id, undefined, {
      recent: true,
      background: true,
      reportScopeChanges: true,
    });
    try {
      // Cancellation settles bounded transport admission asynchronously; the new
      // source must start without waiting for the deliberately unreleased body.
      await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledTimes(2));
      await fresh;
      expect(JSON.stringify(useCodexStore.getState().events[id])).toContain(
        "current source body",
      );
      release(page(id, "retired source body"));
      expect(await old).toBeInstanceOf(HistoryReadScopeChangedError);
      expect(JSON.stringify(useCodexStore.getState().events[id])).not.toContain(
        "retired source body",
      );
    } finally {
      release(page(id, "cleanup old source"));
      await Promise.allSettled([old, fresh]);
    }
  },
);

it("keeps a token revocation latched even when the device immediately returns to the original values", async () => {
  const id = "history-source-returned-values";
  let release!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = codexService
    .loadThreadHistory(id, undefined, {
      recent: true,
      reportScopeChanges: true,
    })
    .catch((error) => error);
  changeSource("token");
  usePairingStore.setState({ desktops: [source], selectedHost: source.host });
  release(page(id, "retired read cannot revive"));
  expect(await pending).toBeInstanceOf(HistoryReadScopeChangedError);
  expect(useCodexStore.getState().historyLoadedMap[id]).not.toBe(true);
});

it("shares identical source/page requests across harmless device label changes", async () => {
  const id = "history-source-same-page";
  let release!: (value: unknown) => void;
  api.threadRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = codexService.loadThreadHistory(id, undefined, { recent: true });
  usePairingStore.getState().renameDesktop(source.host, "renamed fixture");
  const second = codexService.loadThreadHistory(id, undefined, {
    recent: true,
  });
  expect(api.threadRead).toHaveBeenCalledOnce();
  release(page(id, "shared exact source"));
  await Promise.all([first, second]);
  expect(JSON.stringify(useCodexStore.getState().events[id])).toContain(
    "shared exact source",
  );
});
