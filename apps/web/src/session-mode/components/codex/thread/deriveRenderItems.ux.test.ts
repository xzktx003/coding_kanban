import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { deriveRenderItems } from "./deriveRenderItems";
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
