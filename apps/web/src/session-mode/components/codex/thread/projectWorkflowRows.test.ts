import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectWorkflowRows } from "./projectWorkflowRows";
import { findThreadMatches } from "@session/features/thread-workflows/model";

const item = (
  type: string,
  id: string,
  fields: object,
  owner = "owner",
  turn = "turn",
  method = "item/completed",
) => ({
  method,
  params: { threadId: owner, turnId: turn, item: { type, id, ...fields } },
});
it("indexes projected message text once, using stable virtual anchors and public summaries only", () => {
  const events = [
    item(
      "userMessage",
      "user",
      {
        content: [
          { type: "text", text: "question" },
          { type: "localImage", path: "/owner/image.png" },
        ],
      },
      "owner",
      "turn",
      "item/started",
    ),
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "owner",
        turnId: "turn",
        itemId: "reply",
        delta: "before",
      },
    },
    item("reasoning", "reason", {
      summary: ["public"],
      content: ["private raw"],
    }),
    item("agentMessage", "reply", { text: "FINAL", phase: "final_answer" }),
    item("agentMessage", "other", { text: "other owner" }, "other"),
  ] as ServerNotification[];
  const rows = groupThreadActivities(buildThreadRows(events), events);
  const result = projectWorkflowRows("owner", rows, events);
  expect(result.messages.map((message) => message.text)).toEqual([
    "question\n![image](/owner/image.png)",
    "FINAL",
    "public",
  ]);
  expect(result.messages[1].rowId).toBe(
    rows.find((row) => {
      if (row.item.kind !== "event") return false;
      const event = row.item.event;
      return (
        (event.method === "item/started" ||
          event.method === "item/completed") &&
        event.params.item.id === "reply"
      );
    })!.key,
  );
  expect(result.lastUserRowId).toBe(result.messages[0].rowId);
  expect(
    result.messages.every(
      (message) =>
        !message.text.includes("private raw") &&
        !message.text.includes("other owner"),
    ),
  ).toBe(true);
});
it("includes tool-only turn boundaries and does not mark live delta as a complete reply", () => {
  const events = [
    {
      method: "turn/completed",
      params: {
        threadId: "owner",
        turn: { id: "tools", status: "completed", items: [] },
      },
    },
    {
      method: "turn/started",
      params: {
        threadId: "owner",
        turn: { id: "live", status: "inProgress", items: [] },
      },
    },
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "owner",
        turnId: "live",
        itemId: "live-reply",
        delta: "partial",
      },
    },
  ] as ServerNotification[];
  const result = projectWorkflowRows("owner", buildThreadRows(events), events);
  expect(result.turns).toEqual([
    { id: "tools", completed: true },
    { id: "live", completed: false },
  ]);
  expect(result.messages).toMatchObject([
    { itemId: "live-reply", turnId: "live", text: "partial", completed: false },
  ]);
});

it("preserves native phase so completed commentary stays out of fallback search", () => {
  const events = [
    item("userMessage", "user", {
      content: [{ type: "text", text: "needle question", text_elements: [] }],
    }),
    item("agentMessage", "progress", {
      text: "needle commentary",
      phase: "commentary",
    }),
    item("agentMessage", "answer", {
      text: "needle final",
      phase: "final_answer",
    }),
  ] as ServerNotification[];
  const projected = projectWorkflowRows(
    "owner",
    groupThreadActivities(buildThreadRows(events), events),
    events,
  );
  expect(projected.messages[1].phase).toBe("commentary");
  expect(
    findThreadMatches(projected.messages, "needle").map(
      (match) => match.itemId,
    ),
  ).toEqual(["user", "answer"]);
});
