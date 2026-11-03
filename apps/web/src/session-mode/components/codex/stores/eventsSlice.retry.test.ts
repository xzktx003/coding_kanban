import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "./useCodexStore";

const event = (method: string, params: object) => ({ method, params }) as any;
const retry = (turnId = "turn") =>
  event("error", {
    threadId: "thread",
    turnId,
    willRetry: true,
    error: { message: "Reconnecting 1/5", codexErrorInfo: null },
  });
const delta = (turnId: string, text = "received output") =>
  event("item/agentMessage/delta", {
    threadId: "thread",
    turnId,
    itemId: "reply",
    delta: text,
  });

beforeEach(() => {
  useCodexStore.setState({
    events: {},
    retryNoticeMap: {},
    streamingAgentMessages: {},
    threadStatusMap: {},
    turnTimingMap: {
      thread: {
        turnId: "turn",
        startedAtMs: 1,
        durationMs: null,
        status: "inProgress",
      },
    },
  });
});

it("keeps a retry notice through unrelated lifecycle events and stale turns", () => {
  const store = useCodexStore.getState();
  store.addEvent("thread", retry());
  store.addEvent(
    "thread",
    event("thread/status/changed", {
      threadId: "thread",
      status: { type: "active", activeFlags: [] },
    }),
  );
  expect(useCodexStore.getState().retryNoticeMap.thread).toBe(
    "Reconnecting 1/5",
  );
  store.addEvent(
    "thread",
    event("thread/tokenUsage/updated", {
      threadId: "thread",
      turnId: "turn",
      tokenUsage: {
        total: { totalTokens: 1 },
        last: { totalTokens: 1 },
        modelContextWindow: null,
      },
    }),
  );
  expect(useCodexStore.getState().retryNoticeMap.thread).toBe(
    "Reconnecting 1/5",
  );
  const oldRetry = retry("old-turn");
  oldRetry.params.error.message = "stale retry";
  store.addEvent("thread", oldRetry);
  store.addTranscriptDeltas("thread", [delta("old-turn")]);
  expect(useCodexStore.getState().retryNoticeMap.thread).toBe(
    "Reconnecting 1/5",
  );
  store.setStreamingAgentDeltas("thread", [delta("turn")]);
  expect(useCodexStore.getState().retryNoticeMap.thread).toBeUndefined();
});

it("does not retain a completed turn's retry in a new accepted turn", () => {
  const store = useCodexStore.getState();
  store.addEvent("thread", retry());
  store.addEvent(
    "thread",
    event("turn/started", {
      threadId: "thread",
      turn: { id: "next", status: "inProgress", startedAt: 2, items: [] },
    }),
  );
  expect(useCodexStore.getState().retryNoticeMap.thread).toBeUndefined();
  store.addEvent("thread", retry("turn"));
  expect(useCodexStore.getState().retryNoticeMap.thread).toBeUndefined();
});

it("clears the notice on the matching turn completion but not a stale completion", () => {
  const store = useCodexStore.getState();
  store.addEvent("thread", retry());
  const completed = (id: string) =>
    event("turn/completed", {
      threadId: "thread",
      turn: { id, status: "completed", items: [], durationMs: 100 },
    });
  store.addEvent("thread", completed("old-turn"));
  expect(useCodexStore.getState().retryNoticeMap.thread).toBe(
    "Reconnecting 1/5",
  );
  store.addEvent("thread", completed("turn"));
  expect(useCodexStore.getState().retryNoticeMap.thread).toBeUndefined();
});
