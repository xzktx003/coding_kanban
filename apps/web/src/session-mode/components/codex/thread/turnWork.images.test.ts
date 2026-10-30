import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectTurnWork } from "./turnWork";

it("keeps generated images and native image-limit notices outside the completed process fold", () => {
  const events = [
    {
      method: "item/completed",
      params: {
        threadId: "owner",
        turnId: "turn",
        item: {
          type: "imageGeneration",
          id: "quota",
          status: "failed",
          result: "",
          revisedPrompt: null,
          failure: {
            type: "usageLimitExceeded",
            limitId: "image_gen",
            resetsAt: null,
          },
        },
      },
    },
    {
      method: "turn/completed",
      params: {
        threadId: "owner",
        turn: { id: "turn", status: "completed", durationMs: 200, items: [] },
      },
    },
  ] as unknown as ServerNotification[];
  const rows = groupThreadActivities(buildThreadRows(events), events);
  const result = projectTurnWork(rows, events, undefined, new Set(), "owner");
  expect(
    result.some(
      (row) =>
        !row.work &&
        row.item.kind === "event" &&
        (row.item.event.method === "item/started" ||
          row.item.event.method === "item/completed") &&
        row.item.event.params.item.id === "quota",
    ),
  ).toBe(true);
});
