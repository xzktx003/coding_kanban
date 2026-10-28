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
  /**
   * Every retained row's turn, message rows included. The prompt rail marks a
   * turn current while any of its rows is on screen, matching how the shipped
   * webview observes `[data-turn-key]` containers rather than prompt bubbles,
   * so a turn read through its command or file-change rows still counts.
   */
  const turnIdByRowId = new Map<string, string>();
  const turns = new Map<string, WorkflowTurn>();
  const completedTurns = new Set<string>();
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
    if (event.method === "turn/completed") {
      if (event.params.turn.status === "completed") completedTurns.add(turnId);
      else completedTurns.delete(turnId);
      turns.set(turnId, {
        id: turnId,
        completed: event.params.turn.status !== "inProgress",
      });
    } else if (!previous) turns.set(turnId, { id: turnId, completed: false });
  }
  for (const row of rows) {
    // A grouped command row carries no event of its own, so its turn comes from
    // the commands inside it. `deriveRenderItems` flushes the buffer on every
    // `item/started` and on `turn/completed`, so a group cannot straddle turns
    // in practice — but it is cheap to read that from the sources instead of
    // trusting it, and a group that ever did straddle one is left unmapped
    // rather than attributed to a turn it only partly belongs to.
    if (row.item.kind === "cmdGroup") {
      const owners = new Set(
        row.item.actionSources.map(
          (source) => `${source.threadId}\u0000${source.turnId}`,
        ),
      );
      const [only] = [...owners];
      if (owners.size !== 1 || !only) continue;
      const [owner, turn] = only.split("\u0000");
      if (owner === threadId && turn) turnIdByRowId.set(row.key, turn);
      continue;
    }
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
    turnIdByRowId.set(row.key, event.params.turnId);
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
  const latestTurnId = [...turns.keys()].at(-1);
  // The native turn renderer chooses a terminal assistant item, not the last
  // completed answer in any turn. Keep first-seen item order through late ACKs.
  // This temporary index contains identities/status only, never tool bodies.
  const items = new Map<
    string,
    { id: string; type: string; completed: boolean; phase?: string | null }
  >();
  for (const event of events) {
    if (
      (event.method !== "item/started" && event.method !== "item/completed") ||
      event.params.threadId !== threadId ||
      event.params.turnId !== latestTurnId
    )
      continue;
    const item = event.params.item;
    // Plans have their own document surface, outside native assistant grouping.
    if (item.type === "plan") continue;
    items.set(item.id, {
      id: item.id,
      type: item.type,
      completed: event.method === "item/completed",
      ...(item.type === "agentMessage" ? { phase: item.phase } : {}),
    });
  }
  const ordered = [...items.values()];
  let index = ordered.length - 1;
  const trailing = ordered[index]?.type !== "agentMessage";
  if (trailing) {
    while (index >= 0) {
      const item = ordered[index];
      if (
        item.completed &&
        (item.type === "reasoning" ||
          (completedTurns.has(latestTurnId!) &&
            (item.type === "commandExecution" ||
              item.type === "dynamicToolCall")))
      )
        index--;
      else break;
    }
  }
  const candidate = ordered[index];
  const answer =
    candidate?.type === "agentMessage" &&
    (!trailing || candidate.phase === "final_answer")
      ? candidate
      : undefined;
  let latestAssistantRowId: string | undefined;
  if (
    answer?.completed &&
    (answer.phase != null ||
      (answer.phase == null && completedTurns.has(latestTurnId!)))
  ) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (
        message.turnId === latestTurnId &&
        message.itemId === answer.id &&
        message.role === "assistant" &&
        message.completed &&
        message.text.trim()
      ) {
        latestAssistantRowId = message.rowId;
        break;
      }
    }
  }
  return {
    latestTurnId,
    latestAssistantRowId,
    messages,
    turnIdByRowId,
    turns: [...turns.values()],
    lastUserRowId: [...messages]
      .reverse()
      .find((message) => message.role === "user")?.rowId,
  };
}

/** No fallback to old completed history when a known newer/not-loaded turn is
 * absent from this bounded projection. Known older timing snapshots are harmless. */
export function latestAssistantActionRow(
  projection: ReturnType<typeof projectWorkflowRows>,
  observedTurnIds: readonly (string | null | undefined)[] = [],
  latestIdentityUnknown = false,
): string | undefined {
  if (
    latestIdentityUnknown ||
    observedTurnIds.some(
      (id) => id && !projection.turns.some((turn) => turn.id === id),
    )
  )
    return undefined;
  return projection.latestAssistantRowId;
}
