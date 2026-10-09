import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import {
  compactCodexTranscript,
  estimateTranscriptBytes,
  estimateTransientBytes,
} from "./codexTranscriptMemoryBudget";

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

const commandDelta = (turnId: string, itemId = "cmd"): ServerNotification =>
  ({
    method: "item/commandExecution/outputDelta",
    params: { threadId: "thread", turnId, itemId, delta: "x".repeat(100) },
  }) as ServerNotification;

describe("codex transcript memory budget", () => {
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

  it("bounds oversized command output while preserving user and assistant text", () => {
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
    const cmd = (result.events[2] as any).params.item
      .aggregatedOutput as string;
    expect(cmd.length).toBeLessThanOrEqual(64);
    expect(cmd).toContain("...[truncated ");
    expect((result.events[0] as any).params.item.content[0].text).toBe(
      "keep user",
    );
    expect((result.events[1] as any).params.item.text).toBe("keep assistant");
    expect(result.compactedPayloadCount).toBe(1);
    expect(result.evicted).toBe(false);
  });

  it("bounds dynamic and mcp tool payload strings without stringifying JSON", () => {
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
    expect(dynamicItem.contentItems[0].imageUrl.length).toBeLessThanOrEqual(64);
    expect(dynamicItem.arguments.prompt).toContain("...[truncated ");
    expect(mcpItem.arguments.query.length).toBeLessThanOrEqual(64);
    expect(mcpItem.result.content[0].text.length).toBeLessThanOrEqual(64);
  });

  it("drops hidden transcript deltas before applying the budget", () => {
    const events = [user("t1"), commandDelta("t1"), agent("t1")];
    const result = compactCodexTranscript(events, {
      maxBytes: 100_000,
      maxEvents: 20,
    });
    expect(result.events).toEqual([events[0], events[2]]);
    expect(result.hiddenEventCount).toBe(1);
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
      maxEvents: 3000,
      targetEvents: 1500,
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
    expect(result.sameTurnTrimmedEventCount).toBeGreaterThan(0);
    expect(result.truncatedTurnIds).toEqual(["live"]);
  });
});
