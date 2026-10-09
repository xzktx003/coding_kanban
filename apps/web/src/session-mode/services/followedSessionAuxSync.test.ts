import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  history: vi.fn(),
  queue: vi.fn(),
  threads: {} as Record<string, any>,
}));
vi.mock("./apiAdapt/cc", () => ({ ccGetSessionMessages: api.history }));
vi.mock("./followupService", () => ({
  followupService: { load: api.queue },
  useFollowupStore: { getState: () => ({ threads: api.threads }) },
}));
vi.mock("../lib/eventStream", () => ({ openEventStream: () => () => {} }));
import { useCCStore } from "../stores/cc";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import {
  refreshClaudeHistory,
  startFollowedSessionAuxSync,
} from "./followedSessionAuxSync";
beforeEach(() => {
  api.threads = {};
  api.history.mockReset().mockResolvedValue([]);
  api.queue.mockReset().mockResolvedValue({});
  useCCStore.setState({
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
    activeSessionId: null,
  });
});
afterEach(() => vi.useRealTimers());
it("background history stays display-only and preserves a stream update during the read", async () => {
  let resolve!: (value: unknown) => void;
  api.history.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = refreshClaudeHistory("cc");
  useCCStore.setState({
    activeSessionId: "other",
    sessionMessagesMap: {
      cc: [
        {
          type: "assistant",
          uuid: "reply",
          session_id: "cc",
          message: { content: [{ type: "text", text: "live" }] },
        } as any,
      ],
    },
  });
  resolve([
    {
      type: "assistant",
      uuid: "reply",
      message: { content: [{ type: "text", text: "old" }] },
    },
  ]);
  await pending;
  expect(
    (useCCStore.getState().sessionMessagesMap.cc[0] as any).message.content[0]
      .text,
  ).toBe("live");
  expect(useCCStore.getState().activeSessionId).toBe("other");
  expect(useCCStore.getState().sessionLoadingMap.cc).toBeUndefined();
});
it("queue snapshots include every opened Codex including detached tabs", async () => {
  vi.useFakeTimers();
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a" },
      { kind: "codex", id: "b" },
    ],
    detachedCard: { kind: "codex", id: "c" },
  });
  const stop = startFollowedSessionAuxSync();
  await vi.advanceTimersByTimeAsync(1);
  expect(new Set(api.queue.mock.calls.map((c) => c[0]))).toEqual(
    new Set(["a", "b", "c"]),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.queue).toHaveBeenCalledTimes(6);
  stop();
});

it("idle Codex queues poll every thirty seconds and queued work stays responsive", async () => {
  vi.useFakeTimers();
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "idle" }],
    detachedCard: null,
  });
  api.threads.idle = { revision: 1, items: [] };
  const stop = startFollowedSessionAuxSync();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(api.queue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.queue).toHaveBeenCalledTimes(1);
    api.threads.idle = { revision: 2, items: [{ status: "queued" }] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.queue).toHaveBeenCalledTimes(2);
    api.threads.idle = { revision: 3, items: [] };
    await vi.advanceTimersByTimeAsync(29000);
    expect(api.queue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.queue).toHaveBeenCalledTimes(3);
  } finally {
    stop();
  }
});
