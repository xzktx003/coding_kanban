import { beforeEach, expect, it } from "vitest";
import {
  useAgentCenterStore,
  type AgentCenterCard,
} from "./useAgentCenterStore";

const a: AgentCenterCard = {
  kind: "codex",
  id: "a",
  cwd: "/project-a",
  worktreePath: "/project-a/worktree",
};
const b: AgentCenterCard = { kind: "codex", id: "b", cwd: "/project-b" };
const c: AgentCenterCard = { kind: "cc", id: "c", cwd: "/project-c" };
beforeEach(() => {
  localStorage.clear();
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    currentAgentCardKind: null,
    cardsViewMode: "solo",
    cardSizeMap: {},
  });
});
it("appends opened sessions across projects and reopening activates without moving or duplicating", () => {
  const store = useAgentCenterStore.getState();
  store.addAgentCard(a);
  store.addAgentCard(b);
  store.addAgentCard(c);
  store.addAgentCard({ ...a, preview: "renamed", worktreePath: undefined });
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
  expect(useAgentCenterStore.getState().cards[0].worktreePath).toBe(
    a.worktreePath,
  );
});
it("moves tabs without switching the active session", () => {
  const store = useAgentCenterStore.getState();
  [a, b, c].forEach((card) => store.addAgentCard(card));
  store.moveCard(c, a);
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("c");
});
it("closing selects the right neighbor, then the left, then a new chat", () => {
  const store = useAgentCenterStore.getState();
  [a, b, c].forEach((card) => store.addAgentCard(card));
  store.setCurrentAgentCardId("b", "codex");
  store.removeCard(b);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("c");
  store.removeCard(c);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("a");
  store.removeCard(a);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBeNull();
});
it("closing a background tab does not switch selection; agent kind disambiguates IDs", () => {
  const store = useAgentCenterStore.getState();
  store.addAgentCard(a);
  store.addAgentCard({ ...a, kind: "cc" });
  store.removeCard(a);
  expect(useAgentCenterStore.getState().cards).toHaveLength(1);
  expect(useAgentCenterStore.getState().currentAgentCardKind).toBe("cc");
});
it("restores order, active identity, layout and closed tabs after rehydration", async () => {
  const store = useAgentCenterStore.getState();
  [a, b, c].forEach((card) => store.addAgentCard(card));
  store.moveCard(c, a);
  store.removeCard(b);
  store.setCardsViewMode("grid");
  const saved = localStorage.getItem("kanban.session.agent-center-store")!;
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    currentAgentCardKind: null,
    cardsViewMode: "solo",
  });
  localStorage.setItem("kanban.session.agent-center-store", saved);
  await useAgentCenterStore.persist.rehydrate();
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual([
    "c",
    "a",
  ]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("c");
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("grid");
});
it("does not import the accumulated legacy card collection as followed tabs", async () => {
  localStorage.setItem(
    "kanban.session.agent-center-store",
    JSON.stringify({
      version: 4,
      state: { cards: [a, b, c], cardsViewMode: "list" },
    }),
  );
  await useAgentCenterStore.persist.rehydrate();
  expect(useAgentCenterStore.getState().cards).toEqual([]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBeNull();
  expect(useAgentCenterStore.getState().cardsViewMode).toBe("list");
});
