import { beforeEach, expect, it } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import {
  nextRecentViewedCard,
  recentViewedCards,
  resetViewedChats,
} from "./recentView";

beforeEach(() => {
  resetViewedChats();
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "first" },
      { kind: "codex", id: "second" },
      { kind: "codex", id: "third" },
    ],
    currentAgentCardId: "first",
  } as never);
});

it("returns the followed chat viewed immediately before the current one", () => {
  useAgentCenterStore.setState({ currentAgentCardId: "second" } as never);
  useAgentCenterStore.setState({ currentAgentCardId: "third" } as never);
  expect(nextRecentViewedCard()?.id).toBe("second");
  useAgentCenterStore.setState({ currentAgentCardId: null } as never);
  expect(nextRecentViewedCard("first")).toBeNull();
  expect(recentViewedCards().map((card) => card.id)).toEqual([
    "third",
    "second",
    "first",
  ]);
});
