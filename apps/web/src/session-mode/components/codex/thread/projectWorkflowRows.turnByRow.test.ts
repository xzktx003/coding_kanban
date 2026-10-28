import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";
import { projectWorkflowRows } from "./projectWorkflowRows";

/**
 * Codex 26.51007.21434 marks a prompt-rail entry current from an
 * IntersectionObserver over the transcript, and what it observes is the turn
 * container, not the prompt bubble:
 *
 *   const Mt = `[data-turn-key]`;
 *   … t.closest(Mt) …
 *   new IntersectionObserver(…, { root: e, rootMargin: `-${At}px 0px 0px 0px` })
 *   "aria-current": g.has(t.id) ? "true" : void 0
 *
 * So a turn stays current while any of its rows is on screen — a reader who has
 * scrolled past the prompt into that turn's commands and diffs is still in it.
 * Marking only message rows would drop the mark over exactly the long turns
 * where the rail matters most, so the projection has to map every retained row
 * to its turn, not just the ones that carry text.
 */
const item = (
  type: string,
  id: string,
  fields: object,
  owner = "owner",
  turn = "turn-a",
  method = "item/completed",
) =>
  ({
    method,
    params: { threadId: owner, turnId: turn, item: { type, id, ...fields } },
  }) as ServerNotification;

const project = (events: ServerNotification[]) =>
  projectWorkflowRows(
    "owner",
    groupThreadActivities(buildThreadRows(events), events),
    events,
  );

it("maps every projected row to its turn, including non-message rows", () => {
  const events = [
    item("userMessage", "ask-a", { content: [{ type: "text", text: "一" }] }),
    item("commandExecution", "cmd-a", {
      command: "pnpm test",
      commandActions: [],
      status: "completed",
    }),
    item("agentMessage", "reply-a", { text: "甲", phase: "final_answer" }),
    item(
      "userMessage",
      "ask-b",
      { content: [{ type: "text", text: "二" }] },
      "owner",
      "turn-b",
    ),
    item("agentMessage", "reply-b", { text: "乙" }, "owner", "turn-b"),
  ] as ServerNotification[];
  const result = project(events);
  const map = result.turnIdByRowId;
  // Each message row resolves to the turn that produced it.
  for (const message of result.messages)
    expect(map.get(message.rowId)).toBe(message.turnId);
  expect(new Set(map.values())).toEqual(new Set(["turn-a", "turn-b"]));
  // The command row carries no text, so it is absent from `messages`; the map
  // must still reach it or a reader scrolled onto it would lose the mark.
  expect(map.size).toBeGreaterThan(result.messages.length);
});

it("leaves rows of other threads out of the map", () => {
  const events = [
    item("userMessage", "ask", { content: [{ type: "text", text: "一" }] }),
    item("agentMessage", "mine", { text: "甲" }),
    item("agentMessage", "theirs", { text: "别人" }, "other", "turn-x"),
  ] as ServerNotification[];
  const map = project(events).turnIdByRowId;
  expect(new Set(map.values())).toEqual(new Set(["turn-a"]));
});
