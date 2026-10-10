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
      for (const method of ["item/reasoning/textDelta", "item/tool/textDelta"])
        events = appendTranscriptEvent(
          events,
          event(method, {
            threadId: "thread",
            turnId: "turn",
            itemId: "private",
            delta: chunk,
          }),
        );
    }

    expect(events).toEqual([]);
  });

  it("keeps command completion metadata while ignoring command output bodies", () => {
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
          aggregatedOutput: null,
          status: "completed",
          exitCode: 0,
          transcriptMetadataOnly: true,
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
          aggregatedOutput: null,
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
    expect(updated[0]).toBe(events[0]);
    expect(updated[0]).toMatchObject({
      params: { item: { status: "completed", aggregatedOutput: null } },
    });
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
  it.each([
    "command/exec/outputDelta",
    "process/outputDelta",
    "rawResponseItem/completed",
    "item/commandExecution/outputDelta",
    "item/commandExecution/terminalInteraction",
    "item/fileChange/outputDelta",
    "turn/diff/updated",
    "item/reasoning/textDelta",
    "item/tool/textDelta",
  ])("does not notify event subscribers for ignored %s bursts", (method) => {
    useCodexStore.setState({ events: {}, retryNoticeMap: {} });
    let eventNotifications = 0;
    const unsubscribe = useCodexStore.subscribe((state, previousState) => {
      if (state.events !== previousState.events) eventNotifications += 1;
    });

    useCodexStore.getState().addEvent(
      "thread",
      event(method, {
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
it("keeps an active assistant stream bounded while preserving its start and latest tail", () => {
  let events: ServerNotification[] = [];
  for (let index = 0; index < 300; index++) {
    const delta = index === 0 ? "a".repeat(1024) : "z".repeat(1024);
    events = appendTranscriptEvent(events, agentDelta("reply", delta));
  }

  const text = (events[0] as any).params.delta as string;
  expect(text.length).toBeLessThanOrEqual(256 * 1024);
  expect(text).toContain("中间内容因会话内存限制已省略");
  expect(text.startsWith("a".repeat(100))).toBe(true);
  expect(text.endsWith("z".repeat(100))).toBe(true);
});
it.each(["hook/started", "hook/completed"])(
  "keeps safe %s statistics without retaining private hook context",
  (method) => {
    const events = appendTranscriptEvent(
      [],
      event(method, {
        threadId: "thread",
        turnId: "turn",
        run: {
          id: "hook",
          status: method === "hook/started" ? "running" : "completed",
          startedAt: 10,
          completedAt: method === "hook/completed" ? 20 : null,
          durationMs: method === "hook/completed" ? 10 : null,
          sourcePath: "/private-hook",
          entries: [{ kind: "context", text: "private context".repeat(10_000) }],
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method,
      params: {
        run: {
          id: "hook",
          status: method === "hook/started" ? "running" : "completed",
          startedAt: 10,
          completedAt: method === "hook/completed" ? 20 : null,
          durationMs: method === "hook/completed" ? 10 : null,
          sourcePath: "/private-hook",
          entries: [],
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain("private context");
  },
);
it("merges repeated hook snapshots by run and method while retaining completion statistics", () => {
  const hook = (method: string, id: string, durationMs: number, turnId = "turn", threadId = "thread") =>
    event(method, {
      threadId,
      turnId,
      run: {
        id,
        status: method === "hook/started" ? "running" : "completed",
        durationMs,
        sourcePath: "/private-hook",
        entries: [],
      },
    });
  let events: ServerNotification[] = [];
  for (let index = 0; index < 100; index++) {
    events = appendTranscriptEvent(events, hook("hook/started", "hook", index));
    events = appendTranscriptEvent(events, hook("hook/completed", "hook", index));
  }
  expect(events).toHaveLength(2);
  expect(events.map((event) => event.method)).toEqual(["hook/started", "hook/completed"]);
  expect((events[1] as any).params.run).toMatchObject({
    id: "hook",
    status: "completed",
    durationMs: 99,
  });
  events = appendTranscriptEvent(events, hook("hook/completed", "other-hook", 1));
  events = appendTranscriptEvent(events, hook("hook/completed", "hook", 2, "other-turn"));
  events = appendTranscriptEvent(events, hook("hook/completed", "hook", 3, "turn", "other-thread"));
  expect(events).toHaveLength(5);
  expect((events[1] as any).params.run.durationMs).toBe(99);
});
it("does not add sleep display items to the chat transcript", () => {
  const events = appendTranscriptEvent(
    [],
    event("item/completed", {
      threadId: "thread",
      turnId: "turn",
      item: { type: "sleep", id: "sleep", durationMs: 1000 },
    }),
  );
  expect(events).toEqual([]);
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
      item: { id: "tool", type: "commandExecution", aggregatedOutput: "old", exitCode: 1 },
    },
  } as any;
  const first = appendTranscriptEvent([], tool);
  const updated = appendTranscriptEvent(first, {
    ...tool,
    params: {
      ...tool.params,
      item: { ...tool.params.item, aggregatedOutput: "new", exitCode: 0 },
    },
  });
  expect(updated).toHaveLength(1);
  expect((updated[0] as any).params.item).toMatchObject({
    aggregatedOutput: null,
    exitCode: 0,
  });
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
  expect((events[0] as any).params.item).toMatchObject({
    id: "large-tool",
    status: "completed",
    aggregatedOutput: null,
    transcriptMetadataOnly: true,
  });
  expect(JSON.stringify(events).length).toBeLessThanOrEqual(64 * 1024);
  expect(JSON.stringify(events)).not.toContain("x".repeat(100));
  expect((incoming as any).params.item.aggregatedOutput.length).toBe(
    2 * 1024 * 1024,
  );
});
