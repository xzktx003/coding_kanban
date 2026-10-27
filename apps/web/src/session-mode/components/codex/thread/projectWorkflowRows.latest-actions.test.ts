import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import {
  projectWorkflowRows,
  latestAssistantActionRow,
} from "./projectWorkflowRows";
const answer = (
  turn: string,
  id: string,
  phase: string | null = "final_answer",
  owner = "owner",
) => ({
  method: "item/completed",
  params: {
    threadId: owner,
    turnId: turn,
    item: { type: "agentMessage", id, text: id, phase },
  },
});
const boundary = (id: string, complete = false) => ({
  method: complete ? "turn/completed" : "turn/started",
  params: {
    threadId: "owner",
    turn: { id, status: complete ? "completed" : "inProgress", items: [] },
  },
});
const project = (input: unknown[]) => {
  const events = input as ServerNotification[];
  return projectWorkflowRows(
    "owner",
    groupThreadActivities(buildThreadRows(events), events),
    events,
  );
};
it("reveals only the designated final answer of the newest native turn", () => {
  const p = project([
    boundary("old"),
    answer("old", "old"),
    boundary("old", true),
    boundary("new"),
    answer("new", "comment", "commentary"),
    answer("new", "first"),
    answer("new", "last"),
    boundary("new", true),
    answer("foreign", "foreign", "final_answer", "other"),
  ]);
  expect(latestAssistantActionRow(p)).toBe(
    p.messages.find((m) => m.itemId === "last")?.rowId,
  );
});
it("does not fall back to a completed old answer when a newer turn has no answer", () => {
  const p = project([
    boundary("old"),
    answer("old", "old"),
    boundary("old", true),
    boundary("new"),
  ]);
  expect(latestAssistantActionRow(p)).toBeUndefined();
});
it("an incomplete replacement final does not reveal the previous final", () => {
  const p = project([
    boundary("new"),
    answer("new", "first"),
    {
      method: "item/started",
      params: {
        threadId: "owner",
        turnId: "new",
        item: {
          type: "agentMessage",
          id: "stream",
          text: "partial",
          phase: "final_answer",
        },
      },
    },
  ]);
  expect(latestAssistantActionRow(p)).toBeUndefined();
});
it("not-loaded or running identities absent from retained rows suppress old visibility", () => {
  const p = project([
    boundary("old"),
    answer("old", "old"),
    boundary("old", true),
  ]);
  expect(latestAssistantActionRow(p, ["not-loaded"])).toBeUndefined();
  expect(latestAssistantActionRow(p, [null], true)).toBeUndefined();
  expect(latestAssistantActionRow(p, ["old"])).toBe(p.messages[0].rowId);
});
it("late observations of a known older turn do not move the most-recent identity", () => {
  const p = project([
    boundary("old"),
    answer("old", "old"),
    boundary("new"),
    answer("new", "new"),
    boundary("new", true),
    boundary("old", true),
  ]);
  expect(latestAssistantActionRow(p, ["old"])).toBe(
    p.messages.find((m) => m.itemId === "new")?.rowId,
  );
});
it("legacy phase-less final requires a completed latest turn; a latest commentary is its own candidate", () => {
  expect(
    latestAssistantActionRow(
      project([boundary("new"), answer("new", "legacy", null)]),
    ),
  ).toBeUndefined();
  const p = project([
    boundary("new"),
    answer("new", "legacy", null),
    boundary("new", true),
  ]);
  expect(latestAssistantActionRow(p)).toBe(p.messages[0].rowId);
  const commentary = project([
    boundary("new"),
    answer("new", "final"),
    answer("new", "comment", "commentary"),
    boundary("new", true),
  ]);
  expect(latestAssistantActionRow(commentary)).toBe(
    commentary.messages.find((m) => m.itemId === "comment")?.rowId,
  );
});
for (const turnDone of [false, true])
  for (const toolDone of [false, true]) {
    it(`trailing command does not invent a native assistant target: turn=${turnDone}, tool=${toolDone}`, () => {
      const command = {
        method: toolDone ? "item/completed" : "item/started",
        params: {
          threadId: "owner",
          turnId: "new",
          item: {
            type: "commandExecution",
            id: "cmd",
            command: "echo owned",
            cwd: "/fixture",
            commandActions: [],
            status: toolDone ? "completed" : "inProgress",
            aggregatedOutput: null,
            exitCode: toolDone ? 0 : null,
          },
        },
      };
      const p = project([
        boundary("new"),
        answer("new", "final"),
        command,
        ...(turnDone ? [boundary("new", true)] : []),
      ]);
      expect(latestAssistantActionRow(p)).toBe(
        turnDone && toolDone
          ? p.messages.find((m) => m.itemId === "final")?.rowId
          : undefined,
      );
    });
  }
it("late completion of an earlier command keeps its original item position", () => {
  const command = (done: boolean) => ({
    method: done ? "item/completed" : "item/started",
    params: {
      threadId: "owner",
      turnId: "new",
      item: {
        type: "commandExecution",
        id: "cmd",
        command: "echo owned",
        cwd: "/fixture",
        commandActions: [],
        status: done ? "completed" : "inProgress",
        aggregatedOutput: null,
      },
    },
  });
  const p = project([
    boundary("new"),
    command(false),
    answer("new", "final"),
    command(true),
    boundary("new", true),
  ]);
  expect(latestAssistantActionRow(p)).toBe(
    p.messages.find((m) => m.itemId === "final")?.rowId,
  );
});
it("failed/interrupted termination does not claim the native completed-tool fallback", () => {
  for (const status of ["failed", "interrupted"]) {
    const end = boundary("new", true);
    end.params.turn.status = status;
    const p = project([
      boundary("new"),
      answer("new", "final"),
      {
        method: "item/completed",
        params: {
          threadId: "owner",
          turnId: "new",
          item: {
            type: "commandExecution",
            id: "cmd",
            command: "echo owned",
            cwd: "/fixture",
            commandActions: [],
            status: "completed",
            aggregatedOutput: null,
          },
        },
      },
      end,
    ]);
    expect(latestAssistantActionRow(p)).toBeUndefined();
  }
});
