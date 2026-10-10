import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "./useCodexStore";
import {
  trackCodexTranscript,
  markCodexTranscriptDormant,
  retainCodexTranscript,
  forgetCodexTranscript,
} from "@session/services/codexTranscriptActivity";
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

it("keeps dormant tasks live without retaining snapshots or deltas, and resumes visible streaming", () => {
  const id = "sleeping";
  trackCodexTranscript(id);
  markCodexTranscriptDormant(id);
  const store = useCodexStore.getState();
  const delta = {
    method: "item/agentMessage/delta",
    params: {
      threadId: id,
      turnId: "live",
      itemId: "answer",
      delta: "payload",
    },
  } as any;
  store.addEvent(id, {
    method: "turn/started",
    params: {
      threadId: id,
      turn: { id: "live", startedAt: 1, status: "inProgress", items: [] },
    },
  } as any);
  expect(useCodexStore.getState().turnTimingMap[id].status).toBe("inProgress");
  for (let i = 0; i < 100; i++) {
    store.setStreamingAgentDeltas(id, [delta]);
    store.addTranscriptDeltas(id, [delta]);
    store.addEvent(id, {
      method: "item/completed",
      params: {
        threadId: id,
        turnId: "live",
        item: { id: String(i), type: "agentMessage", text: "payload" },
      },
    } as any);
  }
  store.addEvent(id, {
    method: "turn/completed",
    params: {
      threadId: id,
      turn: { id: "live", status: "completed", items: [], durationMs: 1 },
    },
  } as any);
  expect(useCodexStore.getState().events[id]).toBeUndefined();
  expect(useCodexStore.getState().streamingAgentMessages[id]).toBeUndefined();
  expect(useCodexStore.getState().turnTimingMap[id].status).toBe("completed");
  const release = retainCodexTranscript(id);
  try {
    store.setStreamingAgentDeltas(id, [delta]);
    expect(useCodexStore.getState().streamingAgentMessages[id]).toBeDefined();
  } finally {
    release();
    forgetCodexTranscript(id);
  }
});
it("drops command events before they enter the retained transcript", () => {
  const before = useCodexStore.getState();

  useCodexStore.getState().addEvent("thread", command("item/completed"));
  useCodexStore.getState().addEvent("thread", command("item/started"));

  expect(useCodexStore.getState()).toBe(before);
  expect(useCodexStore.getState().events.thread).toBeUndefined();
  expect(useCodexStore.getState().commandStatusMap).toEqual({});
  expect(useCodexStore.getState().commandDurationMap).toEqual({});
});

it("strips nested tool payloads from completed turns while preserving final status", () => {
  useCodexStore.getState().addEvent("thread", {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: {
        id: "turn",
        status: "completed",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
        items: [
          {
            id: "cmd",
            type: "commandExecution",
            command: "test",
            commandActions: [],
            status: "completed",
            aggregatedOutput: "x".repeat(1024 * 1024),
            durationMs: 7,
          },
          {
            id: "file",
            type: "fileChange",
            status: "applied",
            changes: [
              {
                path: "/repo/a.ts",
                type: "update",
                oldText: "old",
                newText: "y".repeat(1024 * 1024),
              },
            ],
          },
          {
            id: "answer",
            type: "agentMessage",
            text: "done",
            phase: null,
            memoryCitation: null,
          },
        ],
      },
    },
  } as any);

  const state = useCodexStore.getState();
  expect(state.events.thread).toHaveLength(2);
  expect(state.events.thread[0]).toMatchObject({
    method: "item/completed",
    params: {
      item: {
        id: "answer",
        type: "agentMessage",
        text: "done",
      },
    },
  });
  expect((state.events.thread[1] as any).params.turn.items).toEqual([]);
  expect(JSON.stringify(state.events.thread).includes("x".repeat(1024))).toBe(
    false,
  );
  expect(JSON.stringify(state.events.thread).includes("y".repeat(1024))).toBe(
    false,
  );
  expect((state.events.thread[0] as any).params.item).toEqual({
    id: "answer",
    type: "agentMessage",
    text: "done",
    phase: null,
    memoryCitation: null,
  });
  expect(state.turnTimingMap.thread).toMatchObject({
    turnId: "turn",
    durationMs: 1000,
    status: "completed",
  });
  expect(state.commandStatusMap).toEqual({});
  expect(state.commandDurationMap).toEqual({});
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
