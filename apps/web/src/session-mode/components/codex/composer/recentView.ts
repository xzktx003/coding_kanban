import {
  useAgentCenterStore,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";

const viewed: string[] = [];

/** Most recently selected followed chat stays at the front. */
export function rememberViewedChat(id: string | null) {
  if (!id) return;
  const index = viewed.indexOf(id);
  if (index === 0) return;
  if (index > 0) viewed.splice(index, 1);
  viewed.unshift(id);
  viewed.splice(32);
}

export function resetViewedChats() {
  viewed.splice(0, viewed.length);
}

/** Followed chats in most-recently-viewed order. */
export function recentViewedCards() {
  const cards = useAgentCenterStore.getState().cards;
  return viewed.flatMap((id) => {
    const card = cards.find((item) => item.id === id);
    return card ? [card] : [];
  });
}

/** The followed chat viewed immediately before the current one. */
export function nextRecentViewedCard(
  currentId = useAgentCenterStore.getState().currentAgentCardId,
): AgentCenterCard | null {
  const cards = useAgentCenterStore.getState().cards;
  const start = Math.max(0, viewed.indexOf(currentId ?? ""));
  for (const id of viewed.slice(start + (viewed[start] === currentId ? 1 : 0))) {
    const card = cards.find((item) => item.id === id);
    if (card && card.id !== currentId) return card;
  }
  return null;
}

useAgentCenterStore.subscribe((state, previous) => {
  if (state.currentAgentCardId !== previous.currentAgentCardId)
    rememberViewedChat(state.currentAgentCardId);
});
