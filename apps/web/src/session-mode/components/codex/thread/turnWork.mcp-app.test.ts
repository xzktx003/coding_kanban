import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectTurnWork, turnWorkKey } from "./turnWork";
it("keeps a native MCP App outside the process fold and never duplicates it in all activity", () => {
  const events = [
    {
      method: "turn/started",
      params: {
        threadId: "owner",
        turn: { id: "turn", status: "inProgress", items: [] },
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: "owner",
        turnId: "turn",
        item: {
          id: "app",
          type: "mcpToolCall",
          server: "docs",
          tool: "widget",
          status: "completed",
          arguments: null,
          result: null,
          appContext: { resourceUri: "ui://docs/widget" },
        },
      },
    },
    {
      method: "turn/completed",
      params: {
        threadId: "owner",
        turn: { id: "turn", status: "completed", items: [], durationMs: 0 },
      },
    },
  ] as unknown as ServerNotification[];
  const grouped = groupThreadActivities(buildThreadRows(events), events);
  for (const opened of [
    new Set<string>(),
    new Set([turnWorkKey("owner", "turn")]),
  ]) {
    const rows = projectTurnWork(grouped, events, undefined, opened);
    const appRows = rows.filter(
      (row) =>
        !row.work &&
        row.item.kind === "event" &&
        row.item.event.method === "item/completed" &&
        row.item.event.params.item.id === "app",
    );
    expect(appRows).toHaveLength(1);
    expect(appRows[0].activity).toBeUndefined();
  }
});
