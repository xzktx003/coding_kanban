import { expect, it, vi } from "vitest";
import type { ServerNotification } from "../bindings";
import { mergeHistoryPage } from "./sessionHistoryPages";
const item = (turnId: string, text: string): ServerNotification => ({
  method: "item/completed",
  params: {
    threadId: "a",
    turnId,
    item: {
      type: "agentMessage",
      id: turnId,
      text,
      phase: null,
      memoryCitation: null,
    },
    completedAtMs: 0,
  },
});
it("refreshes the recent page without deleting earlier cached turns", () => {
  const before = [item("old", "older"), item("last", "partial")];
  const result = mergeHistoryPage(
    [item("last", "complete"), item("new", "new")],
    before,
    before,
    ["last", "new"],
  );
  expect(
    result.map(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text,
    ),
  ).toEqual(["older", "complete", "new"]);
});
it("a delayed page preserves streamed items and can prepend earlier messages", () => {
  const before = [item("last", "partial")];
  const live = [item("last", "stream has advanced")];
  const result = mergeHistoryPage(
    [item("old", "older"), item("last", "snapshot")],
    before,
    live,
    ["old", "last"],
    true,
  );
  expect(
    result.map(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text,
    ),
  ).toEqual(["older", "stream has advanced"]);
});
it("a refresh of an older turn stays before a newer streamed turn", () => {
  const before = [item("old", "before"), item("live", "newer")];
  const result = mergeHistoryPage([item("old", "updated")], before, before, [
    "old",
  ]);
  expect(
    result.map((e) => e.method === "item/completed" && e.params.turnId),
  ).toEqual(["old", "live"]);
});

it("an empty history probe preserves live history without serializing its bodies", () => {
  const before = [item("old", "older")],
    current = [...before, item("live", "streaming")];
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(mergeHistoryPage([], before, current, [])).toBe(current);
    expect(serialize).not.toHaveBeenCalled();
  } finally {
    serialize.mockRestore();
  }
});

it("unchanged recent pages compare only replacement items instead of serializing full history", () => {
  const before = Array.from({ length: 10000 }, (_, i) =>
    item(`turn-${i}`, `body-${i}`),
  );
  const serialize = vi.spyOn(JSON, "stringify");
  try {
    expect(
      mergeHistoryPage([item("turn-9999", "body-9999")], before, before, [
        "turn-9999",
      ]),
    ).toBe(before);
    const serializedEvents = serialize.mock.calls.filter(
      ([value]) => Array.isArray(value) && value.length > 100,
    );
    expect(serializedEvents).toHaveLength(0);
  } finally {
    serialize.mockRestore();
  }
});
