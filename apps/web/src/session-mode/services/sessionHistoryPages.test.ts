import { expect, it, vi } from "vitest";
import type { ServerNotification } from "../bindings";
import { mergeHistoryPage } from "./sessionHistoryPages";
import { convertThreadHistoryToEvents } from "../utils/threadHistoryConverter";
import {
  markCachedTurnExecutionUnverified,
  isCachedTurnExecutionUnverified,
} from "./cachedTurnExecutionView";
const item = (turnId: string, text: string): ServerNotification => ({
  method: "item/completed",
  params: {
    threadId: "a",
    turnId,
    item: {
      type: "agentMessage",
      id: turnId,
      text,
      phase: null,
      memoryCitation: null,
    },
    completedAtMs: 0,
  },
});
it("publishes fresh native certainty even when its interrupted body equals the unverified cache JSON", () => {
  const cached: ServerNotification = {
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "turn",
        status: "interrupted",
        startedAt: 1,
        completedAt: 2,
        durationMs: 10,
        items: [],
        itemsView: "full",
        error: null,
      },
    },
  };
  markCachedTurnExecutionUnverified(cached);
  const before = [cached];
  const verified = structuredClone(cached);
  expect(isCachedTurnExecutionUnverified(verified)).toBe(false);
  const result = mergeHistoryPage([verified], before, before, ["turn"]);
  expect(result).not.toBe(before);
  expect(isCachedTurnExecutionUnverified(result[0])).toBe(false);
  expect(JSON.stringify(result)).toBe(JSON.stringify(before));
});
it("refreshes the recent page without deleting earlier cached turns", () => {
  const before = [item("old", "older"), item("last", "partial")];
  const result = mergeHistoryPage(
    [item("last", "complete"), item("new", "new")],
    before,
    before,
    ["last", "new"],
  );
  expect(
    result.map(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text,
    ),
  ).toEqual(["older", "complete", "new"]);
});
it("a delayed page preserves streamed items and can prepend earlier messages", () => {
  const before = [item("last", "partial")];
  const live = [item("last", "stream has advanced")];
  const result = mergeHistoryPage(
    [item("old", "older"), item("last", "snapshot")],
    before,
    live,
    ["old", "last"],
    true,
  );
  expect(
    result.map(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text,
    ),
  ).toEqual(["older", "stream has advanced"]);
});
it("a refresh of an older turn stays before a newer streamed turn", () => {
  const before = [item("old", "before"), item("live", "newer")];
  const result = mergeHistoryPage([item("old", "updated")], before, before, [
    "old",
  ]);
  expect(
    result.map((e) => e.method === "item/completed" && e.params.turnId),
  ).toEqual(["old", "live"]);
});

it("an empty history probe preserves live history without serializing its bodies", () => {
  const before = [item("old", "older")],
    current = [...before, item("live", "streaming")];
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(mergeHistoryPage([], before, current, [])).toBe(current);
    expect(serialize).not.toHaveBeenCalled();
  } finally {
    serialize.mockRestore();
  }
});

it("unchanged recent pages compare only replacement items instead of serializing full history", () => {
  const before = Array.from({ length: 10000 }, (_, i) =>
    item(`turn-${i}`, `body-${i}`),
  );
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(
      mergeHistoryPage([item("turn-9999", "body-9999")], before, before, [
        "turn-9999",
      ]),
    ).toBe(before);
    const serializedEvents = serialize.mock.calls.filter(
      ([value]) => Array.isArray(value) && value.length > 100,
    );
    expect(serializedEvents).toHaveLength(0);
  } finally {
    serialize.mockRestore();
  }
});

it("reconciles native hook counters exactly without serializing chat bodies", () => {
  const history = {
    id: "a",
    turns: [
      {
        id: "hook-turn",
        status: "completed",
        items: [],
        hookRuns: [
          {
            id: "hook",
            eventName: "postToolUse",
            handlerType: "command",
            executionMode: "sync",
            scope: "turn",
            source: "project",
            sourcePath: "/repo/hooks.json",
            displayOrder: "9007199254740994",
            status: "completed",
            statusMessage: null,
            startedAt: "9007199254740995",
            completedAt: "9007199254740996",
            durationMs: "1",
            entries: [{ kind: "feedback", text: "Hook completed" }],
          },
        ],
      },
    ],
  } as any;
  const before = [
    item("old", "large retained reply ".repeat(32768)),
    ...convertThreadHistoryToEvents(history),
  ];
  const page = convertThreadHistoryToEvents(history);
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(mergeHistoryPage(page, before, before, ["hook-turn"])).toBe(before);
    expect(serialize).not.toHaveBeenCalled();

    history.turns[0].hookRuns[0].startedAt = "9007199254740996";
    const updated = mergeHistoryPage(
      convertThreadHistoryToEvents(history),
      before,
      before,
      ["hook-turn"],
    );
    expect(updated).not.toBe(before);
    expect(updated[0]).toBe(before[0]);
    const hook = updated.find((event) => event.method === "hook/completed");
    expect((hook?.params as any).run.startedAt).toBe(9007199254740996n);
  } finally {
    serialize.mockRestore();
  }
});

it("does not serialize an unchanged large replacement reply", () => {
  const before = [item("large", "会话🙂 reply ".repeat(65536))];
  const page = structuredClone(before);
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(mergeHistoryPage(page, before, before, ["large"])).toBe(before);
    expect(serialize).not.toHaveBeenCalled();
  } finally {
    serialize.mockRestore();
  }
});
it("partial item pages retain other items in the same turn", () => {
  const before = [item("live", "keep")];
  const older = [
    {
      ...item("live", "older"),
      params: {
        ...(item("live", "older") as any).params,
        item: { id: "older-item", type: "agentMessage", text: "older" },
      },
    } as any,
  ];
  const merged = mergeHistoryPage(older, before, before, ["live"], true, true);
  expect(merged).toHaveLength(2);
  expect(merged[1]).toBe(before[0]);
});
it("restored live-turn tools stay after older turns and that turn's user input", () => {
  const old = item("old", "older turn");
  const user = {
    method: "item/started",
    params: {
      threadId: "thread",
      turnId: "live",
      item: { id: "user", type: "userMessage", content: [] },
    },
  } as any;
  const reply = item("live", "reply");
  const restored = {
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId: "live",
      item: { id: "tool", type: "commandExecution", command: "echo result" },
    },
  } as any;
  const before = [old, user, reply];
  expect(
    mergeHistoryPage([restored], before, before, ["live"], true, true),
  ).toEqual([old, user, restored, reply]);
});
