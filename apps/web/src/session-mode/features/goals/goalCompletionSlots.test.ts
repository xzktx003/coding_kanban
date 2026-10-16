import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import type { TranscriptWorkRow } from "@session/components/codex/thread/turnWork";
import { goalCompletionFallbackSlot } from "./goalCompletionSlots";

const event = (turnId: string, threadId = "owner"): ServerNotification => ({
  method: "turn/completed",
  params: {
    threadId,
    turn: {
      id: turnId,
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      durationMs: 1000,
      error: null,
      items: [],
      itemsView: "full",
    },
  },
});
const row = (
  key: string,
  turnId: string,
  threadId = "owner",
): TranscriptWorkRow => ({
  key,
  item: { kind: "event", event: event(turnId, threadId), index: 0 },
});
const target = { turnId: "achieved", itemId: null };

it("places a tool-only fallback once after its own last rendered native row", () => {
  expect(
    goalCompletionFallbackSlot(
      "owner",
      target,
      [
        row("older", "old"),
        row("work", "achieved"),
        row("tool", "achieved"),
        row("later", "new"),
      ],
      [event("old"), event("achieved"), event("new")],
    ),
  ).toEqual({ afterRow: "tool" });
});

it("does not add a fallback when an assistant message owns the completion badge", () => {
  expect(
    goalCompletionFallbackSlot(
      "owner",
      { ...target, itemId: "final" },
      [row("work", "achieved")],
      [],
    ),
  ).toBeNull();
  expect(
    goalCompletionFallbackSlot("owner", null, [row("work", "achieved")], []),
  ).toBeNull();
});

it("anchors an empty completed turn between its preceding and following turns", () => {
  const rows = [row("old", "old"), row("new", "new")];
  expect(
    goalCompletionFallbackSlot("owner", target, rows, [
      event("old"),
      event("achieved"),
      event("new"),
    ]),
  ).toEqual({ afterRow: "old" });
  expect(
    goalCompletionFallbackSlot(
      "owner",
      target,
      [row("new", "new")],
      [event("achieved"), event("new")],
    ),
  ).toEqual({ afterRow: null });
  expect(
    goalCompletionFallbackSlot("owner", target, [], [event("achieved")]),
  ).toEqual({ afterRow: null });
});

it("never uses a foreign row or an unproven turn position as its anchor", () => {
  expect(
    goalCompletionFallbackSlot(
      "owner",
      target,
      [row("foreign", "achieved", "foreign")],
      [event("achieved")],
    ),
  ).toEqual({ afterRow: null });
  expect(
    goalCompletionFallbackSlot("owner", target, [row("unknown", "other")], []),
  ).toBeNull();
});
