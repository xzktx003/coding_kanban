import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";

const event = (method: string, item: object) =>
  ({
    method,
    params: { threadId: "root", turnId: "turn", item },
  }) as ServerNotification;

it.each(["inProgress", "completed", "failed"])(
  "matches native wait visibility for %s without discarding protocol data",
  (status) => {
    const events = [
      event("item/completed", {
        type: "agentMessage",
        id: "reply",
        text: "Public reply",
      }),
      event("item/started", {
        type: "collabAgentToolCall",
        id: "wait",
        tool: "wait",
        status: "inProgress",
        receiverThreadIds: ["child"],
      }),
      event("item/completed", {
        type: "collabAgentToolCall",
        id: "wait",
        tool: "wait",
        status,
        receiverThreadIds: ["child"],
      }),
    ];
    const original = structuredClone(events);
    expect(buildThreadRows(events).map((row) => row.key)).toEqual([
      "event-turn-reply",
    ]);
    expect(events).toEqual(original);
  },
);
it("keeps non-wait collaboration and subagent lifecycle visible once per identity", () => {
  const spawn = {
    type: "collabAgentToolCall",
    id: "spawn",
    tool: "spawnAgent",
    status: "completed",
    receiverThreadIds: ["child"],
  };
  const activity = {
    type: "subAgentActivity",
    id: "activity",
    kind: "completed",
    agentThreadId: "child",
    agentPath: "root/child",
  };
  expect(
    buildThreadRows([
      event("item/started", spawn),
      event("item/completed", spawn),
      event("item/started", activity),
      event("item/completed", activity),
    ]).map((row) => row.key),
  ).toEqual(["event-turn-spawn", "event-turn-activity"]);
});
