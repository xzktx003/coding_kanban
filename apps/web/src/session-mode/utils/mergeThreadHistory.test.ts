import { expect, it } from "vitest";
import { mergeThreadHistory } from "./mergeThreadHistory";
import { compactDeltaEvents } from "../components/codex/stores/eventUtils";
const delta = (text: string) =>
  ({
    method: "item/agentMessage/delta",
    params: { threadId: "a", turnId: "turn", itemId: "agent", delta: text },
  }) as any;
const completed = (text: string) =>
  ({
    method: "item/completed",
    params: {
      threadId: "a",
      turnId: "turn",
      item: { id: "agent", type: "agentMessage", text },
    },
  }) as any;
it("keeps the full live compacted delta once when a history snapshot races with streaming", () => {
  const before = [delta("first")];
  const current = compactDeltaEvents(before, delta(" second"));
  const merged = mergeThreadHistory([completed("first")], before, current);
  expect(merged).toEqual([delta("first second")]);
});
it("prefers a live completion over an older partial snapshot without duplicating it", () => {
  const before = [delta("first")];
  const current = [...before, completed("first second")];
  expect(mergeThreadHistory([completed("first")], before, current)).toEqual(
    current,
  );
});
it("adds older history while preserving a separate new live turn", () => {
  const old = {
    method: "item/started",
    params: {
      threadId: "a",
      turnId: "old",
      item: {
        type: "userMessage",
        id: "old-user",
        clientId: "old-request",
        content: [],
      },
    },
  } as any;
  expect(mergeThreadHistory([old], [], [delta("new")])).toEqual([
    old,
    delta("new"),
  ]);
});
it("uses the complete snapshot when no events changed during the read", () => {
  const before = [delta("first")];
  const history = [completed("first second")];
  expect(mergeThreadHistory(history, before, before)).toBe(history);
});
it("does not replace recovered assistant history with an unanchored stream suffix on cold join", () => {
  const history = [completed("prefix plus suffix")];
  expect(mergeThreadHistory(history, [], [delta("suffix")])).toEqual(history);
});
