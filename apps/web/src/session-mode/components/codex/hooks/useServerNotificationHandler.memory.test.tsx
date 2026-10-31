import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "../stores/useCodexStore";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSubagentStore } from "@session/features/subagents/store";
import { useServerNotificationHandler } from "./useServerNotificationHandler";
import { allowSleep } from "@session/services/apiAdapt/codex";
import {
  trackCodexTranscript,
  markCodexTranscriptDormant,
  forgetCodexTranscript,
} from "@session/services/codexTranscriptActivity";
import { useCodexDeliveryStore } from "@session/stores/useCodexDeliveryStore";
import {
  materializeStreamingTextPreview,
  STREAMING_TEXT_LIMIT,
} from "@session/services/codexTranscriptMemoryBudget";
import { installGoalCompletionAutoClear } from "@session/services/goalCompletionAutoClear";

vi.mock("@session/services/apiAdapt/codex", () => ({
  allowSleep: vi.fn().mockResolvedValue(undefined),
  preventSleep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/lib/notify", () => ({ notifyDesktop: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCenterStore.setState({ cards: [], detachedCard: null });
  useSubagentStore.setState({ nodes: {}, families: {}, selection: {} });
  useCodexStore.setState({
    events: {},
    streamingAgentMessages: {},
    threads: [],
    currentThreadId: null,
    currentTurnId: null,
    historyLoadedMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
    commandStatusMap: {},
    commandDurationMap: {},
    tokenUsageMap: {},
    goalMap: {},
    completedGoalMap: {},
  });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
    drafts: {},
  });
});
function handler() {
  return renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: false },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  ).result;
}
const reply = (threadId: string) =>
  ({
    method: "item/completed",
    params: {
      threadId,
      turnId: "turn",
      item: {
        type: "agentMessage",
        id: "reply",
        text: "完整回复",
        phase: null,
        memoryCitation: null,
      },
    },
  }) as any;

it("cancels buffered frames on dormancy and acknowledges hidden message receipts without retaining bodies", () => {
  const id = "cold-handler";
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id }] });
  trackCodexTranscript(id);
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(77);
  const h = handler();
  try {
    act(() =>
      h.current({
        method: "item/agentMessage/delta",
        params: {
          threadId: id,
          turnId: "turn",
          itemId: "answer",
          delta: "queued before hidden",
        },
      } as any),
    );
    act(() => markCodexTranscriptDormant(id));
    expect(cancel).toHaveBeenCalledWith(77);
    useCodexDeliveryStore.setState({
      entries: {
        [JSON.stringify([id, "received"])]: {
          id: "received",
          threadId: id,
          text: "sent",
          images: [],
          status: "sent",
        },
      },
    });
    act(() =>
      h.current({
        method: "item/completed",
        params: {
          threadId: id,
          turnId: "turn",
          item: {
            id: "user",
            type: "userMessage",
            clientId: "received",
            content: [],
          },
        },
      } as any),
    );
    expect(useCodexDeliveryStore.getState().entries).toEqual({});
    expect(useCodexStore.getState().events[id]).toBeUndefined();
    act(() =>
      h.current({
        method: "item/agentMessage/delta",
        params: {
          threadId: id,
          turnId: "turn",
          itemId: "answer",
          delta: "new hidden text",
        },
      } as any),
    );
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    forgetCodexTranscript(id);
    request.mockRestore();
    cancel.mockRestore();
  }
});

it("does not retain messages or discover children from an unrelated global thread", () => {
  const h = handler();
  act(() => {
    h.current(reply("unopened"));
    h.current({
      method: "item/completed",
      params: {
        threadId: "unopened",
        turnId: "turn",
        item: {
          type: "collabAgentToolCall",
          id: "spawn",
          tool: "spawnAgent",
          receiverThreadIds: ["unrelated-child"],
          agentsStates: {},
          prompt: "x".repeat(100_000),
        },
      },
    } as any);
  });
  expect(useCodexStore.getState().events).toEqual({});
  expect(useSubagentStore.getState().nodes).toEqual({});
});

it.each(["followed", "detached", "current"])(
  "preserves transcript for %s sessions",
  (membership) => {
    if (membership === "followed")
      useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
    if (membership === "detached")
      useAgentCenterStore.setState({
        detachedCard: { kind: "codex", id: "a" },
      });
    if (membership === "current")
      useCodexStore.setState({ currentThreadId: "a" });
    const h = handler();
    act(() => h.current(reply("a")));
    expect(useCodexStore.getState().events.a).toContainEqual(reply("a"));
  },
);

it("bounds same-frame deltas before they leave the notification buffer", () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  const h = handler();
  act(() => {
    for (let index = 0; index < 300; index++)
      h.current({
        method: "item/agentMessage/delta",
        params: {
          threadId: "a",
          turnId: "turn",
          itemId: "reply",
          delta: index === 0 ? "a".repeat(1024) : "z".repeat(1024),
        },
      } as ServerNotification);
    h.current({
      method: "turn/plan/updated",
      params: { threadId: "a", turnId: "turn", explanation: null, plan: [] },
    } as ServerNotification);
  });

  const state = useCodexStore.getState() as any;
  const message = state.streamingAgentMessages.a;
  const text = message.preview
    ? materializeStreamingTextPreview(message.preview)
    : `${message.segments.join("")}${message.current}`;
  expect(text.length).toBeLessThanOrEqual(STREAMING_TEXT_LIMIT);
  expect(text).toContain("中间内容因会话内存限制已省略");
  expect(text.startsWith("a".repeat(100))).toBe(true);
  expect(text.endsWith("z".repeat(100))).toBe(true);
  expect(state.events.a).toHaveLength(1);
  expect(state.events.a[0].method).toBe("turn/plan/updated");
});

it("replaces a live stream with its final snapshot without retaining both copies", () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "a" }] });
  const h = handler();
  act(() => {
    h.current({
      method: "item/agentMessage/delta",
      params: {
        threadId: "a",
        turnId: "turn",
        itemId: "reply",
        delta: "**partial response**",
      },
    } as ServerNotification);
    h.current({
      method: "item/completed",
      params: {
        threadId: "a",
        turnId: "turn",
        item: {
          id: "reply",
          type: "agentMessage",
          text: "**final response**",
          phase: null,
          memoryCitation: null,
        },
      },
    } as ServerNotification);
  });
  const state = useCodexStore.getState() as any;
  expect(state.streamingAgentMessages.a).toBeUndefined();
  expect(state.events.a).toHaveLength(1);
  expect(state.events.a[0].method).toBe("item/completed");
  expect(state.events.a[0].params.item.text).toBe("**final response**");
});

it("discovers and observes children of a followed parent without adding them to tabs", () => {
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id: "parent" }] });
  const h = handler();
  act(() => {
    h.current({
      method: "item/completed",
      params: {
        threadId: "parent",
        turnId: "turn",
        item: {
          type: "collabAgentToolCall",
          id: "spawn",
          tool: "spawnAgent",
          receiverThreadIds: ["child"],
          agentsStates: {},
        },
      },
    } as any);
    h.current(reply("child"));
  });
  expect(useSubagentStore.getState().nodes.child.parentId).toBe("parent");
  expect(useCodexStore.getState().events.child).toContainEqual(reply("child"));
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "parent",
  ]);
  const before = useCodexStore.getState().events.child;
  act(() => useAgentCenterStore.setState({ cards: [] }));
  act(() =>
    h.current({
      ...reply("child"),
      params: {
        ...reply("child").params,
        item: { ...reply("child").params.item, id: "another-reply" },
      },
    }),
  );
  expect(useCodexStore.getState().events.child).toBe(before);
});

it("expires pending questions for an unobserved completed turn without retaining its large body", () => {
  useRequestUserInputStore.getState().addRequest({
    threadId: "unopened",
    requestId: 1,
    turnId: "turn",
    itemId: "i",
    questions: [],
  });
  const h = handler();
  act(() =>
    h.current({
      method: "turn/completed",
      params: {
        threadId: "unopened",
        turn: {
          id: "turn",
          status: "completed",
          items: [
            { type: "agentMessage", id: "reply", text: "x".repeat(100_000) },
          ],
        },
      },
    } as any),
  );
  expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(0);
  expect(useCodexStore.getState().events).toEqual({});
  expect(allowSleep).toHaveBeenCalledWith("unopened");
});

it("retains completed goal lifecycle metadata for a known unobserved history without storing transcript bodies", () => {
  useCodexStore.setState({ threads: [{ id: "history", turns: [] } as never] });
  const goal = {
    threadId: "history", objective: "Ship", status: "complete" as const,
    tokenBudget: null, tokensUsed: 12, timeUsedSeconds: 61, createdAt: 1, updatedAt: 100,
  };
  const h = handler();
  act(() => {
    h.current({ method: "thread/goal/updated", params: { threadId: "history", turnId: null, goal } });
    h.current({ method: "thread/goal/cleared", params: { threadId: "history" } });
  });
  expect(useCodexStore.getState().completedGoalMap.history).toEqual(goal);
  expect(useCodexStore.getState().goalMap.history).toBeUndefined();
  expect(useCodexStore.getState().events).toEqual({});
});

it("ignores completion for an unknown global thread", () => {
  const h = handler();
  act(() => h.current({
    method: "thread/goal/updated", params: { threadId: "unknown", turnId: null, goal: {
      threadId: "unknown", objective: "Ship", status: "complete",
      tokenBudget: null, tokensUsed: 12, timeUsedSeconds: 61, createdAt: 1, updatedAt: 100,
    } },
  }));
  expect(useCodexStore.getState().completedGoalMap).toEqual({});
  expect(useCodexStore.getState().goalMap).toEqual({});
});

it("triggers the owner-only completion coordinator after native goal and idle lifecycle metadata", () => {
  const observe = vi.fn().mockResolvedValue(undefined), reset = vi.fn();
  const stop = installGoalCompletionAutoClear({ observe, reset });
  useCodexStore.setState({ threads: [{ id: "history", turns: [] } as never] });
  const h = handler();
  try {
    act(() => h.current({ method: "thread/goal/updated", params: {
      threadId: "history", turnId: null, goal: {
        threadId: "history", objective: "Ship", status: "complete", tokenBudget: null,
        tokensUsed: 12, timeUsedSeconds: 61, createdAt: 1, updatedAt: 100,
      },
    } }));
    expect(observe).toHaveBeenCalledWith("history");
    observe.mockClear();
    act(() => h.current({ method: "thread/status/changed", params: { threadId: "history", status: { type: "idle" } } }));
    expect(useCodexStore.getState().threadStatusMap.history?.type).toBe("idle");
    expect(observe).toHaveBeenCalledExactlyOnceWith("history");
    act(() => h.current({ method: "account/updated", params: { authMode: "chatgpt", planType: null } } as never));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(useCodexStore.getState().events).toEqual({});
  } finally { stop(); }
});

it("bounds suspended-frame ingress and drains only small batches without losing ordered deltas", () => {
  const id = "bounded-ingress";
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id }] });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((n) => {
      frames.delete(n);
    });
  const original = useCodexStore.getState().setStreamingAgentDeltas;
  const received: string[] = [];
  let deliveredBytes = 0,
    largestBatch = 0;
  useCodexStore.setState({
    setStreamingAgentDeltas: (thread, events) => {
      largestBatch = Math.max(largestBatch, events.length);
      for (const event of events) {
        received.push(event.params.itemId);
        deliveredBytes += event.params.delta.length * 2;
      }
      original(thread, events);
    },
  });
  const h = handler();
  let sentBytes = 0;
  try {
    act(() => {
      for (let i = 0; i < 1000; i++) {
        const delta = `${i}:` + "x".repeat(4096);
        sentBytes += delta.length * 2;
        h.current({
          method: "item/agentMessage/delta",
          params: {
            threadId: id,
            turnId: "turn",
            itemId: `item-${i}`,
            delta,
          },
        } as any);
        expect(sentBytes - deliveredBytes).toBeLessThanOrEqual(1024 * 1024);
        expect(i + 1 - received.length).toBeLessThanOrEqual(128);
      }
    });
    while (frames.size) {
      const [key, frame] = frames.entries().next().value!;
      frames.delete(key);
      act(() => frame(0));
    }
    expect(largestBatch).toBeLessThanOrEqual(32);
    expect(received).toEqual(
      Array.from({ length: 1000 }, (_, i) => `item-${i}`),
    );
    expect(deliveredBytes).toBe(sentBytes);
  } finally {
    useCodexStore.setState({ setStreamingAgentDeltas: original });
    raf.mockRestore();
    cancel.mockRestore();
  }
});

it("keeps interleaved summary indices ordered and flushes them before completion", () => {
  const id = "ordered-ingress";
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id }] });
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(101);
  const original = useCodexStore.getState().addTranscriptDeltas;
  const received: string[] = [];
  useCodexStore.setState({
    addTranscriptDeltas: (thread, events) => {
      for (const event of events) received.push(event.params.delta);
      original(thread, events);
    },
  });
  const h = handler();
  try {
    act(() => {
      for (const [summaryIndex, delta] of [
        [0, "first"],
        [1, "second"],
        [0, "third"],
      ] as const)
        h.current({
          method: "item/reasoning/summaryTextDelta",
          params: {
            threadId: id,
            turnId: "turn",
            itemId: "reason",
            summaryIndex,
            delta,
          },
        } as any);
      h.current({
        method: "turn/completed",
        params: {
          threadId: id,
          turn: {
            id: "turn",
            status: "completed",
            items: [],
          },
        },
      } as any);
    });
    expect(received).toEqual(["first", "second", "third"]);
    expect(useCodexStore.getState().events[id]?.at(-1)?.method).toBe(
      "turn/completed",
    );
    expect(useCodexStore.getState().turnTimingMap[id]?.status).toBe(
      "completed",
    );
  } finally {
    useCodexStore.setState({ addTranscriptDeltas: original });
    raf.mockRestore();
  }
});

it("yields after a costly frame batch and flushes the bounded remainder on unmount", () => {
  const id = "yielding-ingress";
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id }] });
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0,
    clock = 0,
    received = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frames.set(++serial, callback);
      return serial;
    });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id) => {
      frames.delete(id);
    });
  const original = useCodexStore.getState().setStreamingAgentDeltas;
  useCodexStore.setState({
    setStreamingAgentDeltas: (_thread, events) => {
      received += events.length;
      clock += 5;
    },
  });
  const hook = renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: false },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  );
  try {
    act(() => {
      for (let i = 0; i < 100; i++)
        hook.result.current({
          method: "item/agentMessage/delta",
          params: {
            threadId: id,
            turnId: "turn",
            itemId: `item-${i}`,
            delta: "small",
          },
        } as any);
    });
    expect(received).toBe(0);
    const [key, frame] = frames.entries().next().value!;
    frames.delete(key);
    act(() => frame(0));
    expect(received).toBe(32);
    expect(frames.size).toBe(1);
    hook.unmount();
    expect(received).toBe(100);
    expect(frames.size).toBe(0);
  } finally {
    hook.unmount();
    useCodexStore.setState({ setStreamingAgentDeltas: original });
    now.mockRestore();
    raf.mockRestore();
    cancel.mockRestore();
  }
});

it("does not transfer a suspended-frame transcript flood into an unbounded store", () => {
  const id = "reasoning-ingress-flood";
  useAgentCenterStore.setState({ cards: [{ kind: "codex", id }] });
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(107);
  const original = useCodexStore.getState().addTranscriptDeltas;
  let delivered = 0;
  useCodexStore.setState({
    addTranscriptDeltas: (thread, events) => {
      expect(events.length).toBeLessThanOrEqual(32);
      delivered += events.length;
      original(thread, events);
    },
  });
  const h = handler();
  let largestPublished = 0;
  const unsubscribe = useCodexStore.subscribe((state, previous) => {
    if (state.events[id] === previous.events[id]) return;
    const bytes = (state.events[id] ?? []).reduce(
      (sum, event) =>
        sum + ("delta" in event.params ? event.params.delta.length * 2 : 0),
      0,
    );
    largestPublished = Math.max(largestPublished, bytes);
  });
  try {
    act(() => {
      for (let i = 0; i < 1500; i++)
        h.current({
          method: "item/reasoning/summaryTextDelta",
          params: {
            threadId: id,
            turnId: "turn",
            itemId: `item-${i}`,
            summaryIndex: 0,
            delta: `${i}:` + "x".repeat(4096),
          },
        } as any);
      h.current({
        method: "turn/completed",
        params: {
          threadId: id,
          turn: { id: "turn", status: "completed", items: [] },
        },
      } as any);
    });
    expect(delivered).toBe(1500);
    // The existing governor runs immediately after each pressure batch. Its
    // pre-governor publication may include one bounded batch, never the flood.
    expect(largestPublished).toBeLessThanOrEqual(9 * 1024 * 1024);
    expect(useCodexStore.getState().events[id]?.at(-1)?.method).toBe(
      "turn/completed",
    );
  } finally {
    unsubscribe();
    useCodexStore.setState({ addTranscriptDeltas: original });
    raf.mockRestore();
  }
});
