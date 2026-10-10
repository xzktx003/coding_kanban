import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { deriveRenderItems } from "./deriveRenderItems";
it("keeps visible warnings and checklist updates after the commands that preceded them", () => {
  const command = (id: string) => ({
    method: "item/completed",
    params: {
      threadId: "a",
      turnId: "turn",
      item: {
        type: "commandExecution",
        id,
        command: id,
        commandActions: [],
        status: "completed",
      },
    },
  });
  const warning = {
    method: "warning",
    params: { threadId: "a", message: "warning" },
  };
  const plan = {
    method: "turn/plan/updated",
    params: { threadId: "a", turnId: "turn", plan: [] },
  };
  const rows = deriveRenderItems([
    command("first"),
    warning,
    command("second"),
    plan,
  ] as unknown as ServerNotification[]);
  expect(
    rows.map((row) =>
      row.kind === "cmdGroup"
        ? row.actionSources[0].commandItemId
        : row.event.method,
    ),
  ).toEqual(["first", "warning", "second", "turn/plan/updated"]);
});
it("preserves command order around intervening visible tool activity and completed-only assistant messages", () => {
  const command = (id: string) => ({
    method: "item/completed",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: {
        type: "commandExecution",
        id,
        command: id,
        commandActions: [],
        status: "completed",
      },
    },
  });
  const tool = {
    method: "item/completed",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: { type: "mcpToolCall", id: "tool" },
    },
  };
  const reply = {
    method: "item/completed",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: { type: "agentMessage", id: "reply", text: "done" },
    },
  };
  const rows = deriveRenderItems([
    command("before"),
    tool,
    command("after"),
    reply,
  ] as unknown as ServerNotification[]);
  expect(
    rows.map((row) =>
      row.kind === "cmdGroup"
        ? row.actionSources[0].commandItemId
        : (row.event.params as any).item.id,
    ),
  ).toEqual(["before", "tool", "after", "reply"]);
});
it("captures an owning command's verified lifecycle start for its running timer", () => {
  const item = {
    type: "commandExecution",
    id: "timer",
    command: "timer",
    commandActions: [],
    status: "inProgress",
    cwd: "/owner",
    aggregatedOutput: null,
  };
  const events = [
    {
      method: "item/started",
      params: { item, threadId: "owner", turnId: "turn", startedAtMs: 8000 },
    },
    {
      method: "item/completed",
      params: {
        item: { ...item, status: "completed" },
        threadId: "owner",
        turnId: "turn",
        completedAtMs: 11000,
      },
    },
  ] as unknown as ServerNotification[];
  const group = deriveRenderItems(events).find(
    (row) => row.kind === "cmdGroup",
  );
  expect(group).toMatchObject({
    actionSources: [{ threadId: "owner", turnId: "turn", startedAtMs: 8000 }],
  });
});
it("retains a command and its result even when the server cannot classify actions", () => {
  const item = {
    id: "cmd",
    type: "commandExecution",
    command: "custom-tool --flag",
    commandActions: [],
    aggregatedOutput: "useful result",
  };
  const events = [
    { method: "item/started", params: { item } },
    { method: "item/completed", params: { item } },
    { method: "turn/completed", params: { turn: { id: "t" } } },
  ] as unknown as ServerNotification[];
  const rows = deriveRenderItems(events);
  const command = rows.find((row) => row.kind === "cmdGroup");
  expect(command).toMatchObject({
    kind: "cmdGroup",
    actions: [{ type: "unknown", command: "custom-tool --flag" }],
    actionSources: [
      { commandItemId: "cmd", aggregatedOutput: "useful result" },
    ],
    completed: true,
  });
});

it("keeps each grouped command output attached to its own item identity", () => {
  const command = (id: string, output: string) => ({
    id,
    type: "commandExecution",
    command: `echo ${id}`,
    commandActions: [],
    aggregatedOutput: output,
  });
  const events = ["first", "second"].flatMap((id) => [
    { method: "item/started", params: { item: command(id, "") } },
    { method: "item/completed", params: { item: command(id, `${id}-output`) } },
  ]) as unknown as ServerNotification[];
  const group = deriveRenderItems(events).find(
    (row) => row.kind === "cmdGroup",
  );
  expect(group).toMatchObject({
    actionSources: [
      { commandItemId: "first", aggregatedOutput: "first-output" },
      { commandItemId: "second", aggregatedOutput: "second-output" },
    ],
  });
});

it("updates live output across unrelated notifications and replaces it with final output", () => {
  const item = {
    type: "commandExecution",
    id: "cmd",
    command: "run-tests",
    commandActions: [],
    status: "inProgress",
    aggregatedOutput: null,
  };
  const start = {
    method: "item/started",
    params: { threadId: "t", turnId: "turn", item },
  };
  const output = (delta: string) => ({
    method: "item/commandExecution/outputDelta",
    params: { threadId: "t", turnId: "turn", itemId: "cmd", delta },
  });
  const running = [
    start,
    output("first"),
    { method: "warning", params: { message: "note" } },
    output(" second"),
  ];
  expect(
    deriveRenderItems(running as ServerNotification[]).find(
      (row) => row.kind === "cmdGroup",
    ),
  ).toMatchObject({ actionSources: [{ aggregatedOutput: "first second" }] });
  const completed = {
    method: "item/completed",
    params: {
      threadId: "t",
      turnId: "turn",
      item: {
        ...item,
        status: "completed",
        aggregatedOutput: "FULL OUTPUT",
        durationMs: 1200,
        exitCode: 0,
      },
    },
  };
  expect(
    deriveRenderItems([...running, completed] as ServerNotification[]).find(
      (row) => row.kind === "cmdGroup",
    ),
  ).toMatchObject({
    actionSources: [
      {
        aggregatedOutput: "FULL OUTPUT",
        status: "completed",
        durationMs: 1200,
        exitCode: 0,
      },
    ],
  });
});

it("renders a command from a completed-only history snapshot", () => {
  const item = {
    id: "cold",
    type: "commandExecution",
    command: "echo history",
    commandActions: [],
    status: "completed",
    aggregatedOutput: "history",
    durationMs: 10,
    exitCode: 0,
  };
  expect(
    deriveRenderItems([
      {
        method: "item/completed",
        params: { threadId: "t", turnId: "turn", item },
      },
    ] as unknown as ServerNotification[]).find(
      (row) => row.kind === "cmdGroup",
    ),
  ).toMatchObject({
    actions: [{ command: "echo history" }],
    actionSources: [{ aggregatedOutput: "history", status: "completed" }],
  });
});

it("keeps final command output authoritative when a late delta arrives", () => {
  const item = {
    id: "cmd",
    type: "commandExecution",
    command: "echo done",
    commandActions: [],
    status: "completed",
    aggregatedOutput: "done",
    durationMs: 10,
    exitCode: 0,
  };
  const events = [
    {
      method: "item/completed",
      params: { threadId: "t", turnId: "turn", item },
    },
    {
      method: "item/commandExecution/outputDelta",
      params: { threadId: "t", turnId: "turn", itemId: "cmd", delta: "late" },
    },
  ];
  expect(
    deriveRenderItems(events as unknown as ServerNotification[]).find(
      (row) => row.kind === "cmdGroup",
    ),
  ).toMatchObject({ actionSources: [{ aggregatedOutput: "done" }] });
});

it("settles unfinished commands at turn termination without inventing exit codes", () => {
  const item = {
    id: "cmd",
    type: "commandExecution",
    command: "long task",
    commandActions: [],
    status: "inProgress",
    aggregatedOutput: "partial",
    durationMs: null,
    exitCode: null,
  };
  const events = [
    { method: "item/started", params: { threadId: "t", turnId: "turn", item } },
    {
      method: "turn/completed",
      params: {
        threadId: "t",
        turn: { id: "turn", status: "interrupted", items: [] },
      },
    },
  ];
  expect(
    deriveRenderItems(events as unknown as ServerNotification[]).find(
      (row) => row.kind === "cmdGroup",
    ),
  ).toMatchObject({
    actionSources: [
      { status: "inProgress", termination: "interrupted", exitCode: null },
    ],
  });
});

it("renders a command recovered only from a completed turn item", () => {
  const command = {
    id: "cmd",
    type: "commandExecution",
    command: "pnpm test",
    commandActions: [],
    aggregatedOutput: "passed",
  };
  const events = [
    { method: "item/completed", params: { item: command } },
    { method: "turn/completed", params: { turn: { id: "t", items: [] } } },
  ] as unknown as ServerNotification[];

  const commandGroup = deriveRenderItems(events).find(
    (row) => row.kind === "cmdGroup",
  );

  expect(commandGroup).toMatchObject({
    kind: "cmdGroup",
    actions: [{ type: "unknown", command: "pnpm test" }],
    actionSources: [{ commandItemId: "cmd", aggregatedOutput: "passed" }],
    completed: true,
  });
});

it("keeps a completed command group before the completed assistant message that follows it", () => {
  const command = {
    id: "cmd",
    type: "commandExecution",
    command: "pnpm test",
    commandActions: [],
    aggregatedOutput: "passed",
  };
  const message = {
    id: "reply",
    type: "agentMessage",
    text: "Tests passed.",
  };
  const events = [
    { method: "item/completed", params: { item: command } },
    { method: "item/completed", params: { item: message } },
  ] as unknown as ServerNotification[];

  const rows = deriveRenderItems(events);

  expect(rows).toMatchObject([
    {
      kind: "cmdGroup",
      actionSources: [{ commandItemId: "cmd", aggregatedOutput: "passed" }],
      completed: true,
    },
    {
      kind: "event",
      event: {
        method: "item/completed",
        params: { item: { id: "reply", type: "agentMessage" } },
      },
    },
  ]);
});

it("retains projected command state without synthesizing output from a body-free cursor", () => {
  const item = {
    type: "commandExecution",
    id: "cmd",
    command: "checks",
    commandActions: [],
    aggregatedOutput: null,
    status: "inProgress",
    transcriptMetadataOnly: true,
  };
  const rows = deriveRenderItems([
    {
      method: "item/started",
      params: { threadId: "owner", turnId: "turn", item },
    },
    {
      method: "item/commandExecution/outputDelta",
      params: { threadId: "owner", turnId: "turn", itemId: "cmd" },
    },
  ] as unknown as ServerNotification[]);
  expect(rows.find((row) => row.kind === "cmdGroup")).toMatchObject({
    actionSources: [
      {
        aggregatedOutput: null,
        status: "inProgress",
        transcriptMetadataOnly: true,
      },
    ],
  });
});
