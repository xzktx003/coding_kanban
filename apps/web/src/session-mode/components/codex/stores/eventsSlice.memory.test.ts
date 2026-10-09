import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "./useCodexStore";
import {
  materializeStreamingTextPreview,
  STREAMING_TEXT_LIMIT,
} from "@session/services/codexTranscriptMemoryBudget";
beforeEach(() =>
  useCodexStore.setState({
    events: {},
    streamingAgentMessages: {},
    commandStatusMap: {},
    commandDurationMap: {},
  }),
);
const command = (method: "item/started" | "item/completed", turnId = "turn") =>
  ({
    method,
    params: {
      threadId: "thread",
      turnId,
      item: {
        id: "cmd",
        type: "commandExecution",
        command: "test",
        commandActions: [],
        status: method === "item/started" ? "inProgress" : "completed",
        aggregatedOutput: method === "item/started" ? null : "passed",
        durationMs: 7,
      },
    },
  }) as any;
it("a stale started replay cannot regress the completed command status maps", () => {
  useCodexStore.getState().addEvent("thread", command("item/completed"));
  const before = useCodexStore.getState();
  useCodexStore.getState().addEvent("thread", command("item/started"));
  expect(useCodexStore.getState().commandStatusMap.cmd).toBe("completed");
  expect(useCodexStore.getState().commandDurationMap.cmd).toBe(7);
  expect(useCodexStore.getState()).toBe(before);
});
it("accepts a new turn even if its command reuses an older item id", () => {
  useCodexStore.getState().addEvent("thread", command("item/completed"));
  useCodexStore
    .getState()
    .addEvent("thread", command("item/started", "new-turn"));
  expect(useCodexStore.getState().commandStatusMap.cmd).toBe("inProgress");
});

it("keeps streaming assistant text outside the retained transcript and caps it", () => {
  const before = useCodexStore.getState().events.thread;
  useCodexStore.getState().setStreamingAgentDeltas("thread", [
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "message",
        delta: "a".repeat(300 * 1024),
      },
    },
  ] as any);
  const state = useCodexStore.getState();
  expect(state.events.thread).toBe(before);
  const preview = state.streamingAgentMessages.thread.preview;
  expect(preview).toBeDefined();
  const rendered = materializeStreamingTextPreview(preview!);
  expect(rendered.length).toBeLessThanOrEqual(STREAMING_TEXT_LIMIT);
  expect(rendered).toContain("中间内容因会话内存限制已省略");
});

it("appends to the bounded stream tail without rebuilding the retained head", () => {
  const append = (delta: string) =>
    useCodexStore.getState().setStreamingAgentDeltas("thread", [
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "message",
          delta,
        },
      },
    ] as any);
  append("h".repeat(STREAMING_TEXT_LIMIT + 1));
  const head =
    useCodexStore.getState().streamingAgentMessages.thread.preview?.head;
  expect(head).toBeDefined();

  append("tail-sentinel");
  for (let index = 0; index < 20; index++) append("z".repeat(8 * 1024));
  const message = useCodexStore.getState().streamingAgentMessages.thread;
  expect(message.preview?.head).toBe(head);
  const rendered = materializeStreamingTextPreview(message.preview!);
  expect(rendered).toContain("z".repeat(100));
  expect(rendered.length).toBeLessThanOrEqual(STREAMING_TEXT_LIMIT);
});

it("clears the separate stream buffer when a final assistant snapshot arrives", () => {
  useCodexStore.getState().setStreamingAgentDeltas("thread", [
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "message",
        delta: "partial",
      },
    },
  ] as any);
  useCodexStore.getState().addEvent("thread", {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: {
        id: "message",
        type: "agentMessage",
        text: "complete",
        phase: null,
        memoryCitation: null,
      },
    },
  } as any);
  const state = useCodexStore.getState();
  expect(state.streamingAgentMessages.thread).toBeUndefined();
  expect(state.events.thread).toHaveLength(1);
  expect((state.events.thread[0] as any).params.item.text).toBe("complete");
});

it("keeps a partial answer once when a turn ends without its item snapshot", () => {
  useCodexStore.getState().setStreamingAgentDeltas("thread", [
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "message",
        delta: "visible partial reply",
      },
    },
  ] as any);
  useCodexStore.getState().addEvent("thread", {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "interrupted", items: [] },
    },
  } as any);

  const state = useCodexStore.getState();
  expect(state.streamingAgentMessages.thread).toBeUndefined();
  expect(state.events.thread.map((event) => event.method)).toEqual([
    "item/agentMessage/delta",
    "turn/completed",
  ]);
  expect((state.events.thread[0] as any).params.delta).toBe(
    "visible partial reply",
  );
});
