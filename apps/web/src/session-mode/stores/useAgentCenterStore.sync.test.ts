import { beforeEach, expect, it } from "vitest";
import { useAgentCenterStore, selectedAgentCard } from "./useAgentCenterStore";
import { readTabOperations } from "../services/sessionTabJournal";
const a = { kind: "codex" as const, id: "a", cwd: "/a" };
const b = { kind: "cc" as const, id: "b", cwd: "/b" };
beforeEach(() => {
  localStorage.clear();
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
  const operationId =
    useAgentCenterStore.getState().pendingTabOperations[0].id!;
  tabs.setCardsViewMode("grid");
  tabs.acceptSharedTabs(
    { initialized: true, revision: 1, cards: [a, b] },
    undefined,
    [operationId],
  );
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
  const operationId =
    useAgentCenterStore.getState().pendingTabOperations[0].id!;
  tabs.acceptSharedTabs({ initialized: true, revision: 1, cards: [b] });
  expect(useAgentCenterStore.getState().cards).toEqual([b, a]);
  tabs.removeCard(b);
  tabs.acceptSharedTabs(
    { initialized: true, revision: 2, cards: [b, a] },
    undefined,
    [operationId],
  );
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  expect(
    useAgentCenterStore.getState().pendingTabOperations.map((o) => o.seq),
  ).toEqual([2]);
  const persisted = JSON.parse(
    localStorage.getItem("kanban.session.agent-center-store")!,
  );
  expect(persisted.state.pendingTabOperations).toHaveLength(0);
  expect(readTabOperations()).toHaveLength(1);
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
it("does not restore a remotely closed temporary reading target from the browser cache", async () => {
  localStorage.setItem(
    "kanban.session.agent-center-store",
    JSON.stringify({
      version: 5,
      state: {
        cards: [a],
        currentAgentCardId: b.id,
        currentAgentCardKind: b.kind,
        detachedCard: b,
        pendingTabOperations: [],
      },
    }),
  );
  await useAgentCenterStore.persist.rehydrate();
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  expect(useAgentCenterStore.getState().detachedCard).toBeNull();
  expect(selectedAgentCard(useAgentCenterStore.getState())).toBeUndefined();
});
it("a late older snapshot cannot reopen a closed tab, including after reload", async () => {
  const tabs = useAgentCenterStore.getState();
  tabs.acceptSharedTabs({ initialized: true, revision: 10, cards: [a] });
  tabs.acceptSharedTabs({ initialized: true, revision: 9, cards: [a, b] });
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  await useAgentCenterStore.persist.rehydrate();
  tabs.acceptSharedTabs({ initialized: true, revision: 9, cards: [a, b] });
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  tabs.acceptSharedTabs({ initialized: true, revision: 11, cards: [a, b] });
  expect(useAgentCenterStore.getState().cards).toEqual([a, b]);
});
it("restores the confirmed shared list even when an older page overwrote the aggregate cache after acknowledgement", async () => {
  const tabs = useAgentCenterStore.getState();
  tabs.acceptSharedTabs({ initialized: true, revision: 1, cards: [a, b] });
  tabs.removeCard(b);
  const operation = useAgentCenterStore.getState().pendingTabOperations[0];
  tabs.acceptSharedTabs(
    { initialized: true, revision: 2, cards: [a] },
    undefined,
    [operation.id!],
  );
  localStorage.setItem(
    "kanban.session.agent-center-store",
    JSON.stringify({
      version: 5,
      state: {
        cards: [a, b],
        currentAgentCardId: "a",
        pendingTabOperations: [],
      },
    }),
  );
  await useAgentCenterStore.persist.rehydrate();
  expect(useAgentCenterStore.getState().cards).toEqual([a]);
  expect(readTabOperations()).toHaveLength(0);
});

it("unchanged polling snapshots do not notify UI subscribers", () => {
  const snapshot = { initialized: true, revision: 1, cards: [a] };
  useAgentCenterStore.getState().acceptSharedTabs(snapshot);
  const baseline = useAgentCenterStore.getState();
  let notifications = 0;
  const stop = useAgentCenterStore.subscribe(() => notifications++);
  try {
    for (let i = 0; i < 30; i++)
      useAgentCenterStore
        .getState()
        .acceptSharedTabs(JSON.parse(JSON.stringify(snapshot)));
    expect(notifications).toBe(0);
    expect(useAgentCenterStore.getState()).toBe(baseline);
  } finally {
    stop();
  }
});
