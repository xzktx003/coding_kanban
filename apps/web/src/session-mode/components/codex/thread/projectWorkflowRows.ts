import type { ServerNotification } from "@session/bindings";
import type { UserInput } from "@session/bindings/v2";
import type {
  WorkflowMessage,
  WorkflowTurn,
} from "@session/features/thread-workflows/model";
import type { ActivityDisplayRow } from "./activityRows";

function inputText(content: UserInput[]): string {
  return content
    .map((input) => {
      switch (input.type) {
        case "text":
          return input.text;
        case "image":
          return `![image](${input.url})`;
        case "localImage":
          return `![image](${input.path})`;
        case "audio":
          return `[audio](${input.url})`;
        case "localAudio":
          return `[audio](${input.path})`;
        case "skill":
        case "mention":
          return `[${input.name}](${input.path})`;
      }
    })
    .filter(Boolean)
    .join("\n");
}

/** Index the same authoritative text projection the virtual transcript presents. */
export function projectWorkflowRows(
  threadId: string,
  rows: ActivityDisplayRow[],
  events: ServerNotification[],
) {
  const messages: WorkflowMessage[] = [];
  const turns = new Map<string, WorkflowTurn>();
  for (const event of events) {
    if (!("threadId" in event.params) || event.params.threadId !== threadId)
      continue;
    const turnId =
      event.method === "turn/started" || event.method === "turn/completed"
        ? event.params.turn.id
        : "turnId" in event.params
          ? event.params.turnId
          : null;
    if (!turnId) continue;
    const previous = turns.get(turnId);
    if (event.method === "turn/completed")
      turns.set(turnId, {
        id: turnId,
        completed: event.params.turn.status !== "inProgress",
      });
    else if (!previous) turns.set(turnId, { id: turnId, completed: false });
  }
  for (const row of rows) {
    if (row.item.kind !== "event") continue;
    const event = row.item.event;
    if (
      !("threadId" in event.params) ||
      event.params.threadId !== threadId ||
      !("turnId" in event.params) ||
      !event.params.turnId
    )
      continue;
    const base = { rowId: row.key, turnId: event.params.turnId };
    if (event.method === "item/started" || event.method === "item/completed") {
      const item = event.params.item;
      const completed = event.method === "item/completed";
      if (item.type === "userMessage")
        messages.push({
          ...base,
          itemId: item.id,
          role: "user",
          text: inputText(item.content),
          completed: true,
        });
      else if (item.type === "agentMessage")
        messages.push({
          ...base,
          itemId: item.id,
          role: "assistant",
          text: item.text,
          completed,
          phase: item.phase,
        });
      else if (item.type === "plan")
        messages.push({
          ...base,
          itemId: item.id,
          role: "plan",
          text: item.text,
          completed,
        });
      else if (item.type === "reasoning")
        messages.push({
          ...base,
          itemId: item.id,
          role: "summary",
          text: item.summary.join("\n"),
          completed,
        });
    } else if (
      event.method === "item/agentMessage/delta" ||
      event.method === "item/plan/delta"
    ) {
      messages.push({
        ...base,
        itemId: event.params.itemId,
        role: event.method === "item/plan/delta" ? "plan" : "assistant",
        text: event.params.delta,
        completed: false,
      });
    }
  }
  return {
    messages,
    turns: [...turns.values()],
    lastUserRowId: [...messages]
      .reverse()
      .find((message) => message.role === "user")?.rowId,
  };
}
