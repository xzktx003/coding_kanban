import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectTurnWork, turnWorkKey } from "./turnWork";

const event = (method: string, params: object) =>
  ({ method, params }) as ServerNotification;
const message = (id: string, text: string, phase = "commentary") =>
  event("item/completed", {
    threadId: "thread",
    turnId: "turn",
    item: { type: "agentMessage", id, text, phase },
  });
const events = [
  event("turn/started", {
    threadId: "thread",
    turn: { id: "turn", status: "inProgress", items: [] },
  }),
  message("old", "earlier progress"),
  event("item/completed", {
    threadId: "thread",
    turnId: "turn",
    item: {
      type: "commandExecution",
      id: "old-command",
      command: "pwd",
      cwd: "/project",
      status: "completed",
      commandActions: [],
      aggregatedOutput: null,
    },
  }),
  message("latest", "latest progress"),
  event("item/started", {
    threadId: "thread",
    turnId: "turn",
    item: {
      type: "commandExecution",
      id: "current-command",
      command: "check",
      cwd: "/project",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
    },
  }),
  event("warning", {
    threadId: "thread",
    turnId: "turn",
    message: "visible warning",
  }),
];
function project(opened = new Set<string>()) {
  return projectTurnWork(
    groupThreadActivities(buildThreadRows(events), events, {
      threadId: "thread",
      turnId: "turn",
      running: true,
    }),
    events,
    undefined,
    opened,
  );
}
it("shows only the latest progress and current tool by default while retaining warnings", () => {
  const rows = project();
  expect(rows.find((row) => row.work)?.work).toMatchObject({
    running: true,
    expanded: false,
  });
  expect(rows.some((row) => row.key.includes("old-command"))).toBe(false);
  expect(
    rows.some((row) => row.key.includes("old") && !row.key.includes("latest")),
  ).toBe(false);
  expect(rows.some((row) => row.key.includes("latest"))).toBe(true);
  expect(
    rows.some((row) =>
      row.activity?.entries.some(
        (entry) =>
          entry.kind === "command" &&
          entry.source.commandItemId === "current-command",
      ),
    ),
  ).toBe(true);
  expect(
    rows.some(
      (row) => row.item.kind === "event" && row.item.event.method === "warning",
    ),
  ).toBe(true);
});
it("restores every process row with stable keys when all process is explicitly opened", () => {
  const rows = project(new Set([turnWorkKey("thread", "turn")]));
  expect(rows.find((row) => row.work)?.work?.expanded).toBe(true);
  expect(rows.some((row) => row.key.includes("old"))).toBe(true);
  expect(rows.some((row) => row.key.includes("latest"))).toBe(true);
});

it("does not keep a previous commentary beside a newer live commentary from the same turn", () => {
  const rows = projectTurnWork(
    groupThreadActivities(buildThreadRows(events), events, {
      threadId: "thread",
      turnId: "turn",
      running: true,
    }),
    events,
    undefined,
    new Set(),
    "thread",
    { threadId: "thread", turnId: "turn", itemId: "new-live" },
  );
  expect(rows.some((row) => row.key.includes("latest"))).toBe(false);
  expect(
    rows.some((row) =>
      row.activity?.entries.some(
        (entry) =>
          entry.kind === "command" &&
          entry.source.commandItemId === "current-command",
      ),
    ),
  ).toBe(true);
});
