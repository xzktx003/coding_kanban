import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { expect, it } from "vitest";
import type { Thread } from "@session/bindings/v2";
import { convertThreadHistoryToEvents } from "./threadHistoryConverter";
import { projectNativeHookRuns } from "../components/codex/presentation/nativeHookRuns";
const run = {
  id: "hook",
  eventName: "postToolUse",
  handlerType: "command",
  executionMode: "sync",
  scope: "turn",
  sourcePath: "/project/hooks.json",
  source: "project",
  displayOrder: "9007199254740994",
  status: "blocked",
  statusMessage: "Policy",
  startedAt: "9007199254740995",
  completedAt: "9007199254740996",
  durationMs: 1,
  entries: [{ kind: "feedback", text: "Actual output" }],
};
const history = (extra: object = {}) =>
  ({
    id: "owner",
    turns: [
      {
        id: "turn",
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        ...extra,
      },
    ],
  }) as unknown as Thread;
it("restores only actual turn hookRuns metadata with exact bigint counters and owner identity", () => {
  const events = convertThreadHistoryToEvents(
    history({
      hookRuns: [
        run,
        {
          ...run,
          id: "running",
          status: "running",
          completedAt: null,
          durationMs: null,
        },
      ],
    }),
  );
  expect(
    events.filter((event) => event.method.startsWith("hook/")),
  ).toHaveLength(2);
  const runs = projectNativeHookRuns(events).get('["owner","turn"]')!;
  expect(runs[0]).toMatchObject({
    id: "hook",
    displayOrder: 9007199254740994n,
    startedAt: 9007199254740995n,
    status: "blocked",
    entries: [{ kind: "feedback", text: "Actual output" }],
  });
  expect(
    events.find((event) => event.method === "hook/started")?.params,
  ).toMatchObject({ threadId: "owner", turnId: "turn" });
});
it("does not invent runs from tools and rejects malformed actual hook metadata", () => {
  expect(
    convertThreadHistoryToEvents(history()).filter((event) =>
      event.method.startsWith("hook/"),
    ),
  ).toEqual([]);
  const events = convertThreadHistoryToEvents(
    history({
      hookRuns: [
        { ...run, id: "", status: "success" },
        { ...run, startedAt: Number.MAX_SAFE_INTEGER + 1 },
        { ...run, entries: [{ kind: "secret", text: "invalid" }] },
      ],
    }),
  );
  expect(events.filter((event) => event.method.startsWith("hook/"))).toEqual(
    [],
  );
});

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

it("materializes completed chat history without tool payloads or nested turn items", () => {
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
  expect(events).not.toContainEqual(
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
  expect(events).not.toContainEqual(
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
  expect(rows.some((row) => row.item.kind === "cmdGroup")).toBe(true);
  expect(JSON.stringify(events)).not.toContain('"aggregatedOutput":"passed"');
  expect(JSON.stringify(events)).not.toContain('"oldText":"old"');
  expect(JSON.stringify(events)).not.toContain('"newText":"new"');
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        (row.item.event.method === "item/started" ||
          row.item.event.method === "item/completed") &&
        row.item.event.params.item.type === "fileChange",
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
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "item/completed" &&
        row.item.event.params.item.type === "agentMessage",
    ),
  ).toBe(true);
});

it("preserves historical command metadata without raw output or invented terminal states", () => {
  const command = (id: string, status: string) => ({
    id,
    type: "commandExecution",
    status,
    command: id,
    commandActions: [],
    aggregatedOutput: status === "inProgress" ? null : "done",
  });
  const events = convertThreadHistoryToEvents(
    thread([
      {
        ...baseTurn,
        status: "inProgress",
        items: [command("done", "completed"), command("live", "inProgress")],
      },
    ]),
  );
  const snapshots = events.filter((event) => event.method === "item/completed");
  expect(snapshots).toHaveLength(2);
  expect(snapshots.map((event) => (event.params as any).item)).toMatchObject([
    { id: "done", type: "commandExecution", status: "completed" },
    { id: "live", type: "commandExecution", status: "inProgress" },
  ]);
  expect(JSON.stringify(events)).not.toContain('"aggregatedOutput":"done"');
  expect(events.at(-1)).toMatchObject({
    method: "turn/completed",
    params: { turn: { id: "turn", status: "inProgress" } },
  });
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

it("retains public reasoning summaries while removing private history content", () => {
  const events = convertThreadHistoryToEvents(
    history({
      items: [
        {
          type: "reasoning",
          id: "reasoning",
          summary: ["Public summary"],
          content: ["private raw content"],
        },
      ],
    }),
  );
  const itemEvents = events.filter(
    (event) =>
      event.method === "item/started" || event.method === "item/completed",
  );
  expect(itemEvents).toHaveLength(2);
  for (const event of itemEvents)
    expect((event.params as any).item).toMatchObject({
      summary: ["Public summary"],
      content: [],
    });
  expect(JSON.stringify(events)).not.toContain("private raw content");
});
it("bounds actual hook previews and discards unknown bodies and duplicate turn hook metadata", () => {
  const huge = "x".repeat(1024 * 1024);
  const events = convertThreadHistoryToEvents(
    history({
      hookRuns: [
        {
          ...run,
          entries: [{ kind: "feedback", text: huge }],
          unknownOutput: huge,
        },
      ],
      unknownTurnPayload: huge,
    }),
  );
  const hook = events.find((event) => event.method === "hook/completed")!;
  expect((hook.params as any).run.entries[0].text.length).toBeLessThanOrEqual(
    1024,
  );
  expect((hook.params as any).run).not.toHaveProperty("unknownOutput");
  const boundary = events.at(-1)!;
  expect((boundary.params as any).turn).not.toHaveProperty("hookRuns");
  expect((boundary.params as any).turn).not.toHaveProperty(
    "unknownTurnPayload",
  );
  expect((hook.params as any).run.displayOrder).toBe(9007199254740994n);
});
