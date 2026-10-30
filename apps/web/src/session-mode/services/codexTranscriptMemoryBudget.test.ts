import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import {
  compactCodexEventPayload,
  copyTranscriptText,
  compactCodexTranscript,
  estimateTranscriptBytes,
  estimateTransientBytes,
} from "./codexTranscriptMemoryBudget";

it("keeps a metadata-only turn-start notification without requiring an items array", () => {
  const event = {
    method: "turn/started",
    params: {
      threadId: "metadata-only",
      turn: { id: "turn", status: "inProgress" },
    },
  } as ServerNotification;
  expect(compactCodexEventPayload(event)).toBe(event);
});

const privateBodyMethods = [
  "command/exec/outputDelta",
  "process/outputDelta",
  "rawResponseItem/completed",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "turn/diff/updated",
  "item/reasoning/textDelta",
  "item/tool/textDelta",
];

const user = (turnId: string, text = "hello"): ServerNotification =>
  ({
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId,
      completedAtMs: 1,
      item: {
        type: "userMessage",
        id: `${turnId}-user`,
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      },
    },
  }) as ServerNotification;

const agent = (
  turnId: string,
  text = "answer",
  id = `${turnId}-agent`,
): ServerNotification =>
  ({
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId,
      completedAtMs: 2,
      item: {
        type: "agentMessage",
        id,
        text,
        phase: null,
        memoryCitation: null,
      },
    },
  }) as ServerNotification;

const turnStarted = (turnId: string): ServerNotification =>
  ({
    method: "turn/started",
    params: {
      threadId: "thread",
      turn: {
        id: turnId,
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  }) as ServerNotification;

const command = (
  turnId: string,
  output: string,
  id = `${turnId}-cmd`,
): ServerNotification =>
  ({
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId,
      completedAtMs: 3,
      item: {
        type: "commandExecution",
        id,
        pluginId: null,
        scriptPath: null,
        command: "pnpm test",
        cwd: "/repo",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: output,
        exitCode: 0,
        durationMs: 1,
      },
    },
  }) as ServerNotification;

const commandStarted = (
  turnId: string,
  id = `${turnId}-cmd`,
): ServerNotification =>
  ({
    method: "item/started",
    params: {
      threadId: "thread",
      turnId,
      startedAtMs: 3,
      item: {
        type: "commandExecution",
        id,
        pluginId: null,
        scriptPath: null,
        command: "pnpm test",
        cwd: "/repo",
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    },
  }) as ServerNotification;

const commandStartedCompleted = (
  turnId: string,
  output: string,
  id: string,
): ServerNotification[] => [
  commandStarted(turnId, id),
  command(turnId, output, id),
];

const commandDelta = (turnId: string, itemId = "cmd"): ServerNotification =>
  ({
    method: "item/commandExecution/outputDelta",
    params: { threadId: "thread", turnId, itemId, delta: "x".repeat(100) },
  }) as ServerNotification;

const reasoningDelta = (turnId: string, index: number): ServerNotification =>
  ({
    method: "item/reasoning/textDelta",
    params: {
      threadId: "thread",
      turnId,
      itemId: "reasoning",
      contentIndex: index,
      delta: "r".repeat(4096),
    },
  }) as ServerNotification;

describe("codex transcript memory budget", () => {
  it("keeps already projected tool metadata references without retaining tool text", () => {
    const event = command("t1", "small");
    const compacted = compactCodexEventPayload(event);
    expect(compacted).not.toBe(event);
    expect(compacted).toMatchObject({
      params: {
        item: {
          id: "t1-cmd",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: null,
          transcriptMetadataOnly: true,
        },
      },
    });
    expect(compactCodexEventPayload(compacted)).toBe(compacted);
  });

  it("removes large tool bodies before they enter the transcript store", () => {
    const event = command("t1", "x".repeat(2 * 1024 * 1024));
    const compacted = compactCodexEventPayload(event);
    expect(compacted).not.toBe(event);
    expect((compacted as any).params.item.aggregatedOutput).toBeNull();
    expect(JSON.stringify(compacted)).not.toContain("x".repeat(100));
    expect(estimateTranscriptBytes(compacted)).toBeLessThanOrEqual(64 * 1024);
    expect((event as any).params.item.aggregatedOutput).toHaveLength(
      2 * 1024 * 1024,
    );
  });

  it("preserves user text and bounds a long assistant reply as a marked preview", () => {
    const userEvent = user("t1", "u".repeat(128 * 1024));
    const assistantText = "a".repeat(300 * 1024);
    const assistantEvent = agent("t1", assistantText);
    expect(compactCodexEventPayload(userEvent)).toBe(userEvent);
    const compacted = compactCodexEventPayload(assistantEvent) as any;
    const preview = compacted.params.item.text as string;
    expect(preview.length).toBeLessThanOrEqual(256 * 1024);
    expect(preview).toContain("中间内容因会话内存限制已省略");
    expect(preview.startsWith("a".repeat(100))).toBe(true);
    expect(preview.endsWith("a".repeat(100))).toBe(true);
  });

  it("estimates retained bytes without allocating JSON copies", () => {
    const event = agent("t1", "abc");
    expect(estimateTranscriptBytes([event])).toBeGreaterThan(6);
    expect(estimateTransientBytes([event])).toBe(
      estimateTranscriptBytes([event]),
    );
  });

  it("returns the same array when already under budget and handles empty input", () => {
    const events = [user("t1"), agent("t1")];
    expect(
      compactCodexTranscript(events, { maxBytes: 100_000, maxEvents: 20 })
        .events,
    ).toBe(events);
    expect(
      compactCodexTranscript([], { maxBytes: 1, maxEvents: 1 }),
    ).toMatchObject({
      events: [],
      evicted: false,
      trimmedEventCount: 0,
    });
  });

  it("keeps bounded command metadata while preserving user and assistant text", () => {
    const huge = "x".repeat(200);
    const events = [
      user("t1", "keep user"),
      agent("t1", "keep assistant"),
      command("t1", huge),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 100_000,
      maxEvents: 20,
      toolTextLimit: 64,
    });
    const cmd = (result.events[2] as any).params.item;
    expect(cmd.aggregatedOutput).toBeNull();
    expect(cmd.transcriptMetadataOnly).toBe(true);
    expect(cmd).toMatchObject({
      id: "t1-cmd",
      status: "completed",
      exitCode: 0,
    });
    expect(JSON.stringify(cmd)).not.toContain(huge);
    expect((result.events[0] as any).params.item.content[0].text).toBe(
      "keep user",
    );
    expect((result.events[1] as any).params.item.text).toBe("keep assistant");
    expect(result.compactedPayloadCount).toBe(1);
    expect(result.evicted).toBe(false);
  });

  it("removes dynamic and mcp bodies while retaining bounded lifecycle metadata", () => {
    const result = compactCodexTranscript(
      [
        {
          method: "item/completed",
          params: {
            threadId: "thread",
            turnId: "t1",
            completedAtMs: 4,
            item: {
              type: "dynamicToolCall",
              id: "dyn",
              namespace: null,
              tool: "draw",
              arguments: { prompt: "p".repeat(200) },
              status: "completed",
              contentItems: [
                {
                  type: "inputImage",
                  imageUrl: "data:image/png;base64," + "x".repeat(200),
                },
              ],
              success: true,
              durationMs: 1,
            },
          },
        } as ServerNotification,
        {
          method: "item/completed",
          params: {
            threadId: "thread",
            turnId: "t1",
            completedAtMs: 5,
            item: {
              type: "mcpToolCall",
              id: "mcp",
              server: "s",
              tool: "t",
              status: "completed",
              arguments: { query: "q".repeat(200) },
              appContext: null,
              pluginId: null,
              result: {
                content: [{ text: "r".repeat(200) }],
                structuredContent: null,
                _meta: null,
              },
              error: null,
              durationMs: 1,
            },
          },
        } as ServerNotification,
      ],
      { maxBytes: 100_000, maxEvents: 20, toolTextLimit: 64 },
    );
    const dynamicItem = (result.events[0] as any).params.item;
    const mcpItem = (result.events[1] as any).params.item;
    expect(dynamicItem).toMatchObject({
      id: "dyn",
      status: "completed",
      arguments: null,
      contentItems: [],
      success: true,
      transcriptMetadataOnly: true,
    });
    expect(mcpItem).toMatchObject({
      id: "mcp",
      status: "completed",
      result: null,
      transcriptMetadataOnly: true,
    });
    expect(mcpItem.arguments.query.length).toBeLessThanOrEqual(64);
    expect(mcpItem.arguments.query).not.toBe("q".repeat(200));
    for (const item of [dynamicItem, mcpItem]) {
      expect(JSON.stringify(item)).not.toContain("x".repeat(100));
      expect(JSON.stringify(item)).not.toContain("p".repeat(100));
      expect(JSON.stringify(item)).not.toContain("q".repeat(100));
      expect(JSON.stringify(item)).not.toContain("r".repeat(100));
      expect(estimateTranscriptBytes(item)).toBeLessThan(4096 * 2);
    }
  });

  it("drops hidden deltas while retaining safe hook lifecycle statistics", () => {
    const events = [
      user("t1"),
      commandDelta("t1"),
      {
        method: "hook/started",
        params: {
          threadId: "thread",
          turnId: "t1",
          run: {
            id: "hook",
            status: "running",
            sourcePath: "/private-hook",
            entries: [
              { kind: "context", text: "private context".repeat(1000) },
            ],
          },
        },
      },
      {
        method: "hook/completed",
        params: {
          threadId: "thread",
          turnId: "t1",
          run: {
            id: "hook",
            status: "completed",
            durationMs: 23,
            sourcePath: "/private-hook",
            entries: [
              { kind: "context", text: "private context".repeat(1000) },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "t1",
          completedAtMs: 3,
          item: { type: "sleep", id: "sleep", durationMs: 1000 },
        },
      },
      agent("t1"),
    ] as ServerNotification[];
    const result = compactCodexTranscript(events, {
      maxBytes: 100_000,
      maxEvents: 20,
    });
    expect(result.events.map((event) => event.method)).toEqual([
      "item/completed",
      "hook/started",
      "hook/completed",
      "item/completed",
    ]);
    expect(result.events[0]).toBe(events[0]);
    expect(result.events[3]).toBe(events[5]);
    expect((result.events[1] as any).params.run).toMatchObject({
      id: "hook",
      status: "running",
      sourcePath: "/private-hook",
      entries: [],
    });
    expect((result.events[2] as any).params.run).toMatchObject({
      id: "hook",
      status: "completed",
      durationMs: 23,
      sourcePath: "/private-hook",
      entries: [],
    });
    expect(result.hiddenEventCount).toBe(2);
    expect(result.compactedPayloadCount).toBe(2);
    expect(result.evicted).toBe(false);
  });

  it("evicts whole oldest turns to the low-water budget and reports retained history", () => {
    const events = [
      user("old"),
      agent("old", "a".repeat(80)),
      user("middle"),
      agent("middle", "b".repeat(80)),
      turnStarted("live"),
      user("live"),
      agent("live", "c".repeat(80)),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 500,
      targetBytes: 350,
      maxEvents: 4,
      targetEvents: 3,
      activeTurnId: "live",
    });
    const retainedTurns = result.events.map(
      (event) => (event.params as any).turnId ?? (event.params as any).turn?.id,
    );
    expect(retainedTurns).not.toContain("old");
    expect(retainedTurns).not.toContain("middle");
    expect(retainedTurns).toEqual(["live", "live", "live"]);
    expect(result.trimmedEventCount).toBe(4);
    expect(result.evicted).toBe(true);
    expect(result.oldestTurnId).toBe("live");
  });

  it("keeps protected turn groups while evicting other old turns", () => {
    const result = compactCodexTranscript(
      [
        user("anchor"),
        agent("anchor", "a".repeat(80)),
        user("old"),
        agent("old", "b".repeat(80)),
        turnStarted("live"),
      ],
      {
        maxBytes: 300,
        targetBytes: 200,
        maxEvents: 4,
        targetEvents: 3,
        activeTurnId: "live",
        protectedTurnIds: new Set(["anchor"]),
      },
    );
    const retainedTurns = result.events.map(
      (event) => (event.params as any).turnId ?? (event.params as any).turn?.id,
    );
    expect(retainedTurns).toContain("anchor");
    expect(retainedTurns).not.toContain("old");
    expect(retainedTurns).toContain("live");
  });

  it("count-trims only whole unprotected turns after the byte target is met", () => {
    const exactCounter = 9_007_199_254_740_995n;
    const largeMetadata = "opaque metadata ".repeat(4096);
    const protectedEvent = {
      method: "item/completed",
      params: {
        threadId: "thread",
        turnId: "anchor",
        completedAtMs: 1,
        item: {
          type: "agentMessage",
          id: "anchor-answer",
          text: "keep protected answer",
          phase: "final_answer",
          memoryCitation: null,
        },
        futureMetadata: { largeMetadata, exactCounter },
      },
    } as ServerNotification;
    const activeDelta = {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread",
        turnId: "active",
        itemId: "active-answer",
        delta: "still streaming",
      },
    } as ServerNotification;
    const hiddenBody = {
      method: "command/exec/outputDelta",
      params: {
        threadId: "thread",
        turnId: "old-hidden",
        processId: "private-process",
        stream: "stdout",
        deltaBase64: "cHJpdmF0ZSBvdXRwdXQ=",
        capReached: false,
      },
    } as ServerNotification;
    const events = [
      user("old-1"),
      hiddenBody,
      protectedEvent,
      user("old-2"),
      agent("old-3"),
      activeDelta,
    ];
    expect(estimateTranscriptBytes(events)).toBeLessThanOrEqual(1024 * 1024);

    const result = compactCodexTranscript(events, {
      maxBytes: 1024 * 1024,
      targetBytes: 1024 * 1024,
      maxEvents: 4,
      targetEvents: 2,
      activeTurnId: "active",
      protectedTurnIds: new Set(["anchor"]),
    });

    expect(result.events).toEqual([protectedEvent, activeDelta]);
    expect(result.events[0]).toBe(protectedEvent);
    expect(result.events[1]).toBe(activeDelta);
    expect((result.events[0].params as any).futureMetadata).toEqual({
      largeMetadata,
      exactCounter,
    });
    expect(result.hiddenEventCount).toBe(1);
    expect(result.trimmedEventCount).toBe(4);
    expect(result.compactedPayloadCount).toBe(0);
    expect(result.estimatedBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(result.oldestTurnId).toBe("anchor");
  });

  it("bounds an oversized active turn by keeping user text and newest assistant", () => {
    const events = [
      turnStarted("live"),
      user("live", "keep user"),
      agent("live", "old assistant", "agent-old"),
      command("live", "one", "cmd-1"),
      command("live", "two", "cmd-2"),
      command("live", "three", "cmd-3"),
      agent("live", "new assistant", "agent-new"),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 1,
      maxEvents: 1,
      activeTurnId: "live",
      maxActiveToolGroups: 1,
    });
    const texts = result.events
      .map((event) => (event as any).params.item?.text)
      .filter(Boolean);
    const commandIds = result.events
      .map((event) => (event as any).params.item)
      .filter((item) => item?.type === "commandExecution")
      .map((item) => item.id);
    expect(texts).toEqual(["new assistant"]);
    expect((result.events[1] as any).params.item.content[0].text).toBe(
      "keep user",
    );
    expect(commandIds).toEqual([]);
    expect(result.sameTurnTrimmedEventCount).toBeGreaterThan(0);
    expect(result.truncatedTurnIds).toEqual(["live"]);
  });

  it("hard-bounds many completed tools in one active turn while preserving in-progress tools", () => {
    const bigOutput = "x".repeat(64 * 1024);
    const events = [
      turnStarted("live"),
      user("live", "keep user"),
      ...Array.from({ length: 1000 }, (_, index) =>
        command("live", bigOutput, `cmd-${index}`),
      ),
      commandStarted("live", "running"),
      agent("live", "new assistant", "agent-new"),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 8 * 1024 * 1024,
      targetBytes: 4 * 1024 * 1024,
      // Removed tool bodies no longer create byte pressure. Keep the original
      // payload load and byte gates, with stricter event gates to exercise eviction.
      maxEvents: 500,
      targetEvents: 250,
      activeTurnId: "live",
    });
    const retainedItems = result.events
      .map((event) => (event as any).params.item)
      .filter(Boolean);
    const retainedCommands = retainedItems.filter(
      (item) => item.type === "commandExecution",
    );
    expect(result.estimatedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(retainedItems.some((item) => item.type === "userMessage")).toBe(
      true,
    );
    expect(
      retainedItems.some(
        (item) => item.type === "agentMessage" && item.text === "new assistant",
      ),
    ).toBe(true);
    expect(
      retainedCommands.some(
        (item) => item.id === "running" && item.status === "inProgress",
      ),
    ).toBe(true);
    expect(retainedCommands.length).toBeLessThan(1000);
    expect(
      retainedCommands.every((item) => item.aggregatedOutput === null),
    ).toBe(true);
    expect(result.compactedPayloadCount).toBe(1001);
    expect(result.sameTurnTrimmedEventCount).toBeGreaterThan(0);
    expect(result.truncatedTurnIds).toEqual(["live"]);
  });

  it("does not protect tools forever after their started event is completed", () => {
    const bigOutput = "x".repeat(64 * 1024);
    const events = [
      turnStarted("live"),
      user("live", "keep user"),
      ...Array.from({ length: 500 }, (_, index) =>
        commandStartedCompleted("live", bigOutput, `cmd-${index}`),
      ).flat(),
      commandStarted("live", "running"),
      agent("live", "new assistant", "agent-new"),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 8 * 1024 * 1024,
      targetBytes: 4 * 1024 * 1024,
      // Preserve the started/completed payload load while forcing event pressure
      // after tool bodies are removed; the byte gates remain unchanged.
      maxEvents: 500,
      targetEvents: 250,
      activeTurnId: "live",
    });
    const retainedItems = result.events
      .map((event) => (event as any).params.item)
      .filter(Boolean);
    const retainedCommands = retainedItems.filter(
      (item) => item.type === "commandExecution",
    );
    expect(result.estimatedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(retainedCommands.some((item) => item.id === "running")).toBe(true);
    expect(retainedCommands.length).toBeLessThan(500);
    expect(
      retainedCommands.every((item) => item.aggregatedOutput === null),
    ).toBe(true);
    expect(result.compactedPayloadCount).toBe(1001);
    expect(retainedItems.some((item) => item.type === "userMessage")).toBe(
      true,
    );
    expect(
      retainedItems.some(
        (item) => item.type === "agentMessage" && item.text === "new assistant",
      ),
    ).toBe(true);
  });

  it("drops private active-turn reasoning bodies before budgeting the same pressure load", () => {
    const events = [
      turnStarted("live"),
      user("live", "keep user"),
      ...Array.from({ length: 2000 }, (_, index) =>
        reasoningDelta("live", index),
      ),
      agent("live", "new assistant", "agent-new"),
    ];
    const result = compactCodexTranscript(events, {
      maxBytes: 8 * 1024 * 1024,
      targetBytes: 4 * 1024 * 1024,
      maxEvents: 3000,
      targetEvents: 1500,
      activeTurnId: "live",
    });
    expect(result.estimatedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(
      result.events.some(
        (event) => (event as any).params.item?.type === "userMessage",
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (event) =>
          (event as any).params.item?.type === "agentMessage" &&
          (event as any).params.item.text === "new assistant",
      ),
    ).toBe(true);
    expect(
      result.events.some((event) => event.method.includes("reasoning")),
    ).toBe(false);
    expect(result.hiddenEventCount).toBe(2000);
  });

  it("bounds public plan and reasoning summaries while removing private reasoning and diff bodies", () => {
    const huge = "x".repeat(300 * 1024);
    const events = [
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "t1",
          completedAtMs: 1,
          item: { type: "plan", id: "plan", text: huge },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "t1",
          completedAtMs: 2,
          item: {
            type: "reasoning",
            id: "reasoning",
            summary: [huge],
            content: [huge],
          },
        },
      },
      {
        method: "turn/diff/updated",
        params: { threadId: "thread", turnId: "t1", diff: huge },
      },
    ] as ServerNotification[];

    const compacted = events.map((event) => compactCodexEventPayload(event));
    const planText = (compacted[0] as any).params.item.text as string;
    expect(planText.length).toBeLessThanOrEqual(256 * 1024);
    expect(planText).toContain("中间内容因会话内存限制已省略");
    const summary = (compacted[1] as any).params.item.summary as string[];
    expect(summary.join("").length).toBeLessThanOrEqual(4096);
    expect(summary.join("")).toContain("…");
    expect((compacted[1] as any).params.item.content).toEqual([]);
    const result = compactCodexTranscript(events, {
      maxBytes: 8 * 1024 * 1024,
      maxEvents: 20,
    });
    expect(
      result.events.some((event) => event.method === "turn/diff/updated"),
    ).toBe(false);
    expect(result.hiddenEventCount).toBe(1);
  });

  it("projects tools embedded in a turn without losing user or assistant items", () => {
    const commandItem = (command("t1", "private body".repeat(1000)) as any)
      .params.item;
    const event = {
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: {
          id: "t1",
          items: [
            (user("t1", "keep user") as any).params.item,
            commandItem,
            (agent("t1", "keep assistant") as any).params.item,
          ],
          status: "completed",
        },
      },
    } as ServerNotification;
    const result = compactCodexTranscript([event], {
      maxBytes: 100_000,
      maxEvents: 20,
    });
    const items = (result.events[0] as any).params.turn.items;
    expect(items.map((item: any) => item.id)).toEqual([
      "t1-user",
      "t1-cmd",
      "t1-agent",
    ]);
    expect(items[0].content[0].text).toBe("keep user");
    expect(items[1]).toMatchObject({
      aggregatedOutput: null,
      status: "completed",
    });
    expect(items[2].text).toBe("keep assistant");
    expect(result.compactedPayloadCount).toBe(1);
    expect(compactCodexEventPayload(result.events[0])).toBe(result.events[0]);
  });

  it("rejects every private tool body method before retaining history", () => {
    const events = [user("t1"), agent("t1")];
    for (const method of privateBodyMethods) {
      const result = compactCodexTranscript(
        [
          ...events,
          {
            method,
            params: {
              threadId: "thread",
              turnId: "t1",
              itemId: "tool",
              delta: "private".repeat(1000),
            },
          } as ServerNotification,
        ],
        { maxBytes: 100_000, maxEvents: 20 },
      );
      expect(result.events).toEqual(events);
      expect(result.hiddenEventCount).toBe(1);
    }
  });

  it.each(privateBodyMethods)(
    "returns only a safe cursor when %s is compacted directly",
    (method) => {
      const body = "private body".repeat(100_000);
      const event = {
        method,
        params: {
          threadId: "thread",
          turnId: "t1",
          itemId: "tool",
          delta: body,
          diff: body,
          stdin: body,
          item: { content: body },
        },
      } as ServerNotification;
      const compacted = compactCodexEventPayload(event);
      expect(compacted).toMatchObject({
        method,
        params: { threadId: "thread", turnId: "t1", itemId: "tool" },
      });
      expect(JSON.stringify(compacted)).not.toContain("private body");
      expect(estimateTranscriptBytes(compacted)).toBeLessThan(4096);
      expect(compactCodexEventPayload(compacted)).toBe(compacted);
      expect((event.params as any).delta).toBe(body);
    },
  );
});

// Browser CDP tests cover physical retention; these guard exact UTF-16 fidelity.
it.each(["", "中文😄e\u0301", "head\ud800middle\udc00tail", "a\u0000b"])(
  "copies bounded transcript text without changing code units: %j",
  (text) => {
    expect(copyTranscriptText(text)).toBe(text);
  },
);

it("bounds a protected user message before it can exceed the default thread budget", () => {
  const source = user("live", "x".repeat(5 * 1024 * 1024));
  const result = compactCodexTranscript([source], {
    maxBytes: 8 * 1024 * 1024,
    maxEvents: 3000,
    activeTurnId: "live",
  });
  expect(result.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  const item = (result.events[0] as any).params.item;
  expect(item.id).toBe("live-user");
  expect(item.content[0].text.length).toBeLessThanOrEqual(256 * 1024);
  expect(item.content[0].text).toContain("中间内容因会话内存限制已省略");
  expect((source as any).params.item.content[0].text.length).toBe(
    5 * 1024 * 1024,
  );
});

it("shares the user display budget across text parts and leaves attachment identities intact", () => {
  const source = user("live");
  const attachments = [
    { type: "image", url: "https://fixture/image.png", detail: "high" },
    { type: "localImage", path: "/fixture/local.png" },
    { type: "audio", url: "https://fixture/audio.wav" },
    { type: "skill", name: "skill", path: "/fixture/skill" },
    { type: "mention", name: "file", path: "/fixture/file" },
  ];
  const content = Array.from({ length: 4 }, (_, index) => ({
    type: "text",
    text: `${index}:` + "x".repeat(300 * 1024),
    text_elements: [],
  }));
  (source as any).params.item.content = [...content, ...attachments];
  const compacted = compactCodexEventPayload(source) as any;
  const textLength = compacted.params.item.content
    .filter((part: any) => part.type === "text")
    .reduce((sum: number, part: any) => sum + part.text.length, 0);
  expect(textLength).toBeLessThanOrEqual(256 * 1024);
  attachments.forEach((attachment, index) =>
    expect(compacted.params.item.content[content.length + index]).toBe(
      attachment,
    ),
  );
});

it("remaps retained UTF-8 text elements while discarding ranges crossing omitted text", () => {
  const head = "头🌈";
  const tail = "尾🚀";
  const text = head + "x".repeat(400 * 1024) + tail;
  const utf8 = new TextEncoder();
  const headBytes = utf8.encode(head).length;
  const sourceBytes = utf8.encode(text).length;
  const tailBytes = utf8.encode(tail).length;
  const elements = [
    { byteRange: { start: 0, end: headBytes }, placeholder: "head" },
    {
      byteRange: { start: headBytes + 220000, end: headBytes + 220010 },
      placeholder: "omitted",
    },
    { byteRange: { start: 0, end: sourceBytes }, placeholder: "crossing" },
    {
      byteRange: { start: sourceBytes - tailBytes, end: sourceBytes },
      placeholder: "tail",
    },
  ];
  const source = user("live", text) as any;
  source.params.item.content[0].text_elements = elements;
  const result = compactCodexEventPayload(source) as any;
  const part = result.params.item.content[0];
  expect(part.text_elements.map((element: any) => element.placeholder)).toEqual(
    ["head", "tail"],
  );
  const encoded = utf8.encode(part.text);
  const decode = (element: any) =>
    new TextDecoder().decode(
      encoded.subarray(element.byteRange.start, element.byteRange.end),
    );
  expect(decode(part.text_elements[0])).toBe(head);
  expect(decode(part.text_elements[1])).toBe(tail);
  expect(source.params.item.content[0].text_elements).toBe(elements);
});

it("reduces display text in multiple protected active user groups without removing their identities", () => {
  const users = Array.from({ length: 24 }, (_, index) => {
    const event = user("live", `${index}:` + "x".repeat(256 * 1024)) as any;
    event.params.item.id = `user-${index}`;
    return event;
  });
  const result = compactCodexTranscript(
    [...users, agent("live", "latest reply")],
    {
      maxBytes: 8 * 1024 * 1024,
      maxEvents: 3000,
      activeTurnId: "live",
    },
  );
  expect(result.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.events.map((event) => (event.params as any).item.id)).toEqual([
    ...users.map((event) => event.params.item.id),
    "live-agent",
  ]);
  expect((result.events.at(-1) as any).params.item.text).toBe("latest reply");
});

it("reduces protected reading-window bodies while keeping every turn and user identity", () => {
  const ids = Array.from({ length: 40 }, (_, index) => `pinned-${index}`);
  const events = ids.flatMap((id) => [
    user(id, "u".repeat(128 * 1024)),
    agent(id, "a".repeat(128 * 1024)),
  ]);
  const result = compactCodexTranscript(events, {
    maxBytes: 8 * 1024 * 1024,
    maxEvents: 3000,
    activeTurnId: ids.at(-1),
    protectedTurnIds: new Set(ids),
  });
  expect(result.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.events.length).toBe(events.length);
  expect(result.events.map((event) => (event.params as any).item.id)).toEqual(
    events.map((event) => (event.params as any).item.id),
  );
});

it("reports unshrinkable attachment metadata above budget without corrupting its URL", () => {
  const source = user("live") as any;
  const image = {
    type: "image",
    url: "data:image/png;base64," + "a".repeat(5 * 1024 * 1024),
    detail: "high",
  };
  source.params.item.content = [image];
  const result = compactCodexTranscript([source], {
    maxBytes: 8 * 1024 * 1024,
    maxEvents: 3000,
    activeTurnId: "live",
  });
  expect(result.estimatedBytes).toBeGreaterThan(8 * 1024 * 1024);
  expect((result.events[0] as any).params.item.content[0]).toBe(image);
});

it("does not cut a surrogate pair at either user preview boundary", () => {
  for (const prefix of ["", "a"]) {
    const source = user("live", prefix + "😀".repeat(200 * 1024));
    const result = compactCodexEventPayload(source) as any;
    const text = result.params.item.content[0].text as string;
    expect(text.length).toBeLessThanOrEqual(256 * 1024);
    expect(
      Array.from(text).some(
        (character) =>
          character.length === 1 &&
          character.charCodeAt(0) >= 0xd800 &&
          character.charCodeAt(0) <= 0xdfff,
      ),
    ).toBe(false);
  }
});

it("bounds user display text nested in a turn-start snapshot without dropping native metadata", () => {
  const source = turnStarted("live") as any;
  source.params.turn.items = [
    (user("live", "x".repeat(5 * 1024 * 1024)) as any).params.item,
  ];
  const result = compactCodexEventPayload(source) as any;
  expect(result.params.turn.id).toBe("live");
  expect(result.params.turn.status).toBe("inProgress");
  expect(result.params.turn.items[0].id).toBe("live-user");
  expect(
    result.params.turn.items[0].content[0].text.length,
  ).toBeLessThanOrEqual(256 * 1024);
  expect(source.params.turn.items[0].content[0].text.length).toBe(
    5 * 1024 * 1024,
  );
});

it("returns the original transcript when an over-budget protected attachment cannot be compacted", () => {
  const source = user("live") as any;
  source.params.item.content = [
    {
      type: "image",
      url: "data:image/png;base64," + "x".repeat(3 * 1024 * 1024),
    },
  ];
  const events = [source];
  const result = compactCodexTranscript(events, {
    maxBytes: 4 * 1024 * 1024,
    targetBytes: 2 * 1024 * 1024,
    maxEvents: 1500,
    activeTurnId: "live",
  });
  expect(result.estimatedBytes).toBeGreaterThan(4 * 1024 * 1024);
  expect(result.trimmed).toBe(false);
  expect(result.events[0]).toBe(source);
  expect(result.events).toBe(events);
});
