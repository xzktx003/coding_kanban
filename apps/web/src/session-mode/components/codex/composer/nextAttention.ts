import {
  useAgentCenterStore,
  type AgentCenterCard,
} from "@session/stores/useAgentCenterStore";
import { followedSessionRows } from "@session/hooks/useFollowedSessionStates";

/** Followed tabs that are waiting for input or have unread activity. */
export function attentionCards(cards: readonly AgentCenterCard[]) {
  const needing = new Set(
    followedSessionRows()
      .rows.filter(
        (row) =>
          row.state === "pending" ||
          row.state === "unread" ||
          (row.questions ?? 0) > 0,
      )
      .map((row) => `${row.card.kind}:${row.card.id}`),
  );
  return cards.filter((card) => needing.has(`${card.kind}:${card.id}`));
}

/** The followed tab immediately before or after the selected one. */
export function adjacentFollowedCard(
  direction: -1 | 1,
  currentId = useAgentCenterStore.getState().currentAgentCardId,
) {
  const cards = useAgentCenterStore.getState().cards;
  const index = cards.findIndex((card) => card.id === currentId);
  const next = cards[index + direction];
  return next && next.id !== currentId ? next : null;
}

/** Next followed chat after the current one that is waiting or unread. */
export function nextAttentionCard(
  currentId = useAgentCenterStore.getState().currentAgentCardId,
) {
  const cards = useAgentCenterStore.getState().cards;
  const needing = attentionCards(cards);
  if (needing.length === 0) return null;
  const index = cards.findIndex((card) => card.id === currentId);
  return (
    cards.slice(index + 1).find((card) => needing.includes(card)) ??
    needing.find((card) => card.id !== currentId) ??
    null
  );
}
