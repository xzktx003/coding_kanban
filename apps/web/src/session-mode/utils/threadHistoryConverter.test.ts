import { expect, it } from "vitest";
import type { Thread } from "@session/bindings/v2";
import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { convertThreadHistoryToEvents } from "./threadHistoryConverter";

const baseTurn = {
  id: "turn",
  itemsView: "full",
  status: "completed",
  error: null,
  startedAt: 10,
  completedAt: 12,
  durationMs: 2000,
};

const thread = (turns: unknown[]): Thread =>
  ({
    id: "thread",
    turns,
  }) as Thread;

it("materializes completed history without redundant agent starts or nested turn items", () => {
  const user = {
    type: "userMessage",
    id: "user",
    clientId: "client",
    content: [{ type: "text", text: "hello", text_elements: [] }],
  };
  const agent = {
    type: "agentMessage",
    id: "agent",
    text: "answer",
    phase: null,
    memoryCitation: null,
  };
  const command = {
    type: "commandExecution",
    id: "cmd",
    pluginId: null,
    scriptPath: null,
    command: "pnpm test",
    cwd: "/repo",
    processId: null,
    source: "agent",
    status: "completed",
    commandActions: [{ type: "test", command: "pnpm test" }],
    aggregatedOutput: "passed",
    exitCode: 0,
    durationMs: 50,
  };
  const file = {
    type: "fileChange",
    id: "file",
    status: "applied",
    changes: [
      {
        path: "/repo/a.ts",
        type: "update",
        oldText: "old",
        newText: "new",
      },
    ],
  };
  const turn = { ...baseTurn, items: [user, agent, command, file] };

  const events = convertThreadHistoryToEvents(thread([turn]));

  expect(events).not.toContainEqual(
    expect.objectContaining({
      method: "item/started",
      params: expect.objectContaining({ item: agent }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      method: "item/started",
      params: expect.objectContaining({ item: user }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      method: "item/started",
      params: expect.objectContaining({ item: command }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({ item: agent }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({ item: file }),
    }),
  );
  expect(events.at(-1)).toMatchObject({
    method: "turn/completed",
    params: {
      turn: {
        id: "turn",
        items: [],
        startedAt: 10,
        completedAt: 12,
        durationMs: 2000,
      },
    },
  });

  const rows = buildThreadRows(events);
  expect(
    rows.some(
      (row) =>
        row.item.kind === "cmdGroup" &&
        row.item.actionSources[0]?.aggregatedOutput === "passed",
    ),
  ).toBe(true);
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "item/started" &&
        row.item.event.params.item.type === "userMessage",
    ),
  ).toBe(true);
  const fileSummary = rows.find(
    (row) =>
      row.item.kind === "event" && row.item.event.method === "turn/completed",
  );
  expect(fileSummary?.context?.events?.length).toBeGreaterThan(0);
});

it("keeps question completions visible while stripping completed turn item payloads", () => {
  const question = {
    type: "agentMessage",
    id: "question",
    text: "",
    phase: null,
    memoryCitation: null,
    questions: [{ title: "Pick", options: ["A"] }],
  };

  const events = convertThreadHistoryToEvents(
    thread([{ ...baseTurn, items: [question] }]),
  );

  expect(events).toEqual([
    expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({ item: question }),
    }),
    expect.objectContaining({
      method: "turn/completed",
      params: expect.objectContaining({
        turn: expect.objectContaining({ items: [] }),
      }),
    }),
  ]);
});

it("preserves in-progress turn snapshots and does not mutate the source thread", () => {
  const agent = {
    type: "agentMessage",
    id: "agent",
    text: "stream snapshot",
    phase: null,
    memoryCitation: null,
  };
  const sourceTurn = {
    ...baseTurn,
    status: "inProgress",
    completedAt: null,
    durationMs: null,
    items: [agent],
  };
  const sourceThread = thread([sourceTurn]);

  const events = convertThreadHistoryToEvents(sourceThread);

  expect(events).toEqual([
    expect.objectContaining({
      method: "item/started",
      params: expect.objectContaining({ item: agent }),
    }),
    expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({ item: agent }),
    }),
    expect.objectContaining({
      method: "turn/completed",
      params: expect.objectContaining({
        turn: expect.objectContaining({ items: [agent] }),
      }),
    }),
  ]);
  expect(sourceTurn.items).toEqual([agent]);
  expect((events.at(-1) as any).params.turn).not.toBe(sourceTurn);
});
