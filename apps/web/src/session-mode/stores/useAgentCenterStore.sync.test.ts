import { beforeEach, expect, it } from "vitest";
import { useAgentCenterStore, selectedAgentCard } from "./useAgentCenterStore";
const a = { kind: "codex" as const, id: "a", cwd: "/a" };
const b = { kind: "cc" as const, id: "b", cwd: "/b" };
beforeEach(() => {
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    currentAgentCardKind: null,
    cardsViewMode: "solo",
    cardSizeMap: {},
    pendingTabOperations: [],
    nextTabSequence: 1,
    sharedTabsInitialized: false,
    detachedCard: null,
  });
});
it("remote collections update membership/order without changing local selection, layout or current reading target", () => {
  const tabs = useAgentCenterStore.getState();
  tabs.addAgentCard(a);
  tabs.setCardsViewMode("grid");
  tabs.acceptSharedTabs({ initialized: true, revision: 1, cards: [a, b] }, 1);
  tabs.acceptSharedTabs({ initialized: true, revision: 2, cards: [b] });
  const state = useAgentCenterStore.getState();
  expect(state.cards).toEqual([b]);
  expect(state.currentAgentCardId).toBe("a");
  expect(state.cardsViewMode).toBe("grid");
  expect(selectedAgentCard(state)).toEqual(a);
  expect(state.pendingTabOperations).toEqual([]);
});
it("pending local changes survive remote polling and only acknowledged operations leave the persisted queue", () => {
  const tabs = useAgentCenterStore.getState();
  tabs.addAgentCard(a);
  tabs.acceptSharedTabs({ initialized: true, revision: 1, cards: [b] });
  expect(useAgentCenterStore.getState().cards).toEqual([b, a]);
  tabs.removeCard(b);
  tabs.acceptSharedTabs({ initialized: true, revision: 2, cards: [b, a] }, 1);
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  expect(
    useAgentCenterStore.getState().pendingTabOperations.map((o) => o.seq),
  ).toEqual([2]);
  const persisted = JSON.parse(
    localStorage.getItem("kanban.session.agent-center-store")!,
  );
  expect(persisted.state.pendingTabOperations).toHaveLength(1);
});
it("selection and layout never enter the shared operation queue; metadata updates cannot resurrect closed tabs", () => {
  const tabs = useAgentCenterStore.getState();
  tabs.acceptSharedTabs({ initialized: true, revision: 1, cards: [a, b] });
  tabs.setCurrentAgentCardId("b", "cc");
  tabs.setCardsViewMode("list");
  tabs.setCardSize("b", { height: 400 });
  expect(useAgentCenterStore.getState().pendingTabOperations).toEqual([]);
  tabs.updateCard({ ...a, preview: "name" });
  tabs.acceptSharedTabs({ initialized: true, revision: 2, cards: [b] });
  expect(useAgentCenterStore.getState().cards).toEqual([b]);
});
