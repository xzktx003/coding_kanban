import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "./useCodexStore";
import { appendTranscriptEvent } from "./eventUtils";

const event = (method: string, params: unknown) =>
  ({ method, params }) as ServerNotification;

const agentDelta = (itemId: string, delta: string, turnId = "turn") =>
  event("item/agentMessage/delta", {
    threadId: "thread",
    turnId,
    itemId,
    delta,
  });

const agentCompleted = (
  itemId: string,
  text: string,
  turnId = "turn",
  extra: Record<string, unknown> = {},
) =>
  event("item/completed", {
    threadId: "thread",
    turnId,
    completedAtMs: 1,
    item: { type: "agentMessage", id: itemId, text, ...extra },
  });

const agentStarted = (
  itemId: string,
  text: string,
  turnId = "turn",
  extra: Record<string, unknown> = {},
) =>
  event("item/started", {
    threadId: "thread",
    turnId,
    item: { type: "agentMessage", id: itemId, text, ...extra },
  });

const commandStarted = (itemId = "cmd") =>
  event("item/started", {
    threadId: "thread",
    turnId: "turn",
    item: {
      type: "commandExecution",
      id: itemId,
      pluginId: null,
      scriptPath: null,
      command: "pnpm test",
      cwd: "/repo",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [{ type: "test", command: "pnpm test" }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    },
  });

const commandCompleted = (itemId = "cmd", aggregatedOutput = "ok") =>
  event("item/completed", {
    threadId: "thread",
    turnId: "turn",
    completedAtMs: 2,
    item: {
      type: "commandExecution",
      id: itemId,
      pluginId: null,
      scriptPath: null,
      command: "pnpm test",
      cwd: "/repo",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "test", command: "pnpm test" }],
      aggregatedOutput,
      exitCode: 0,
      durationMs: 10,
    },
  });

const turnCompleted = (items: unknown[]) =>
  event("turn/completed", {
    threadId: "thread",
    turn: {
      id: "turn",
      items,
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 100,
    },
  });

describe("appendTranscriptEvent", () => {
  it("drops hidden raw and output burst payloads from transcript snapshots", () => {
    const chunk = "x".repeat(100_000);
    let events: ServerNotification[] = [];

    for (let i = 0; i < 5; i++) {
      events = appendTranscriptEvent(
        events,
        event("item/commandExecution/outputDelta", {
          threadId: "thread",
          turnId: "turn",
          itemId: "cmd",
          delta: chunk,
        }),
      );
      events = appendTranscriptEvent(
        events,
        event("item/fileChange/outputDelta", {
          threadId: "thread",
          turnId: "turn",
          itemId: "patch",
          delta: chunk,
        }),
      );
      events = appendTranscriptEvent(
        events,
        event("rawResponseItem/completed", {
          threadId: "thread",
          turnId: "turn",
          item: { type: "message", content: chunk },
        }),
      );
    }

    expect(events).toEqual([]);
  });

  it("keeps command completion output while ignoring command output deltas", () => {
    let events = appendTranscriptEvent([], commandStarted());
    events = appendTranscriptEvent(
      events,
      event("item/commandExecution/outputDelta", {
        threadId: "thread",
        turnId: "turn",
        itemId: "cmd",
        delta: "streamed output",
      }),
    );
    events = appendTranscriptEvent(
      events,
      commandCompleted("cmd", "final output"),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: "item/completed",
      params: {
        item: {
          type: "commandExecution",
          aggregatedOutput: "final output",
        },
      },
    });
  });

  it("replaces a running command snapshot with its completed snapshot in place", () => {
    let events = appendTranscriptEvent([], commandStarted("cmd"));
    const warning = event("warning", {
      threadId: "thread",
      turnId: "turn",
      message: "between snapshots",
    });
    events = appendTranscriptEvent(events, warning);
    events = appendTranscriptEvent(events, commandCompleted("cmd", "done"));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      method: "item/completed",
      params: {
        item: {
          type: "commandExecution",
          id: "cmd",
          status: "completed",
          aggregatedOutput: "done",
        },
      },
    });
    expect(events[1]).toBe(warning);
  });

  it("keeps a completed command snapshot when a stale started replay arrives", () => {
    const completed = commandCompleted("cmd", "done");
    const events = appendTranscriptEvent([], completed);
    const updated = appendTranscriptEvent(events, commandStarted("cmd"));

    expect(updated).toBe(events);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toBe(completed);
  });

  it("replaces interleaved assistant deltas with the completed item", () => {
    const warning = event("warning", {
      threadId: "thread",
      turnId: "turn",
      message: "careful",
    });
    let events = appendTranscriptEvent([], agentDelta("agent", "hel"));
    events = appendTranscriptEvent(events, warning);
    events = appendTranscriptEvent(events, agentDelta("agent", "lo"));
    events = appendTranscriptEvent(events, agentCompleted("agent", "hello"));

    expect(events).toEqual([agentCompleted("agent", "hello"), warning]);
  });

  it("replaces assistant started payloads with the completed item", () => {
    const text = "hello".repeat(10_000);
    let events = appendTranscriptEvent([], agentStarted("agent", text));
    events = appendTranscriptEvent(events, agentCompleted("agent", text));

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe("item/completed");
    if (events[0].method !== "item/completed") return;
    expect(events[0].params.item).toMatchObject({
      type: "agentMessage",
      id: "agent",
    });
    if (events[0].params.item.type !== "agentMessage") return;
    expect(events[0].params.item.text).toHaveLength(text.length);
  });

  it("preserves structured questions when replacing streamed assistant text", () => {
    const question = {
      questions: [{ title: "Pick one", options: ["A", "B"] }],
    };
    let events = appendTranscriptEvent([], agentDelta("question", "Pick one"));
    events = appendTranscriptEvent(
      events,
      agentCompleted("question", "", "turn", question),
    );

    expect(events).toEqual([agentCompleted("question", "", "turn", question)]);
  });

  it("materializes missing turn items and strips nested turn item payloads", () => {
    const userItem = {
      type: "userMessage",
      id: "user",
      clientId: "submission",
      content: [{ type: "text", text: "hello", text_elements: [] }],
    };
    let events = appendTranscriptEvent([], turnCompleted([userItem]));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      method: "item/completed",
      params: { item: userItem },
    });
    expect(events[1]).toMatchObject({
      method: "turn/completed",
      params: { turn: { id: "turn", items: [] } },
    });
  });

  it("uses completed turn agent items to replace earlier stream deltas", () => {
    let events = appendTranscriptEvent([], agentDelta("agent", "hel"));
    events = appendTranscriptEvent(
      events,
      turnCompleted([{ type: "agentMessage", id: "agent", text: "hello" }]),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      method: "item/completed",
      params: {
        item: { type: "agentMessage", id: "agent", text: "hello" },
      },
    });
    expect(events[1]).toMatchObject({
      method: "turn/completed",
      params: { turn: { items: [] } },
    });
  });

  it("does not duplicate turn items that already have item notifications", () => {
    const completed = agentCompleted("agent", "hello");
    let events = appendTranscriptEvent([], completed);
    events = appendTranscriptEvent(
      events,
      turnCompleted([{ type: "agentMessage", id: "agent", text: "hello" }]),
    );

    expect(events).toEqual([completed, turnCompleted([])]);
  });
});

describe("codex event store", () => {
  it("does not notify event subscribers for ignored output bursts", () => {
    useCodexStore.setState({ events: {}, retryNoticeMap: {} });
    let eventNotifications = 0;
    const unsubscribe = useCodexStore.subscribe((state, previousState) => {
      if (state.events !== previousState.events) eventNotifications += 1;
    });

    useCodexStore.getState().addEvent(
      "thread",
      event("item/commandExecution/outputDelta", {
        threadId: "thread",
        turnId: "turn",
        itemId: "cmd",
        delta: "x".repeat(100_000),
      }),
    );

    unsubscribe();
    expect(eventNotifications).toBe(0);
    expect(useCodexStore.getState().events).toEqual({});
  });
});
it("keeps one assistant stream item when other events interleave its deltas", () => {
  let events: any[] = [];
  for (let i = 0; i < 1000; i++) {
    events = appendTranscriptEvent(events, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "reply",
        delta: "x",
      },
    } as any);
    events = appendTranscriptEvent(events, {
      method: "turn/plan/updated",
      params: {
        threadId: "thread",
        turnId: "turn",
        explanation: null,
        plan: [],
      },
    } as any);
  }
  const deltas = events.filter((e) => e.method === "item/agentMessage/delta");
  expect(deltas).toHaveLength(1);
  expect(deltas[0].params.delta).toBe("x".repeat(1000));
});
it("compacts reasoning streams by item and part rather than retaining every token", () => {
  let events: any[] = [];
  for (let i = 0; i < 1000; i++) {
    for (const summaryIndex of [0, 1])
      events = appendTranscriptEvent(events, {
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "reasoning",
          summaryIndex,
          delta: String(summaryIndex),
        },
      } as any);
  }
  expect(events).toHaveLength(2);
  expect(events[0].params.delta).toBe("0".repeat(1000));
  expect(events[1].params.delta).toBe("1".repeat(1000));
});
it("final items replace repeated snapshots and ignore stale deltas", () => {
  const finished = {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { id: "reply", type: "agentMessage", text: "final" },
    },
  } as any;
  const events = appendTranscriptEvent([], finished);
  expect(appendTranscriptEvent(events, agentDelta("reply", "late"))).toBe(
    events,
  );
  const tool = {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      item: { id: "tool", type: "commandExecution", aggregatedOutput: "old" },
    },
  } as any;
  const first = appendTranscriptEvent([], tool);
  const updated = appendTranscriptEvent(first, {
    ...tool,
    params: {
      ...tool.params,
      item: { ...tool.params.item, aggregatedOutput: "new" },
    },
  });
  expect(updated).toHaveLength(1);
  expect((updated[0] as any).params.item.aggregatedOutput).toBe("new");
});
it("bounds a large tool snapshot before it reaches the store or cache subscribers", () => {
  const incoming = event("item/completed", {
    threadId: "thread",
    turnId: "turn",
    item: {
      id: "large-tool",
      type: "commandExecution",
      status: "completed",
      aggregatedOutput: "x".repeat(2 * 1024 * 1024),
    },
  });
  const events = appendTranscriptEvent([], incoming);
  expect(
    (events[0] as any).params.item.aggregatedOutput.length,
  ).toBeLessThanOrEqual(64 * 1024);
  expect((events[0] as any).params.item.aggregatedOutput).toContain(
    "[truncated",
  );
  expect((incoming as any).params.item.aggregatedOutput.length).toBe(
    2 * 1024 * 1024,
  );
});
