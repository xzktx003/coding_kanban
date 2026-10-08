import { useAgentCenterStore } from "../stores/useAgentCenterStore";

/** Display membership only; never discovers, selects or starts an Agent. */
export function openedSessions() {
  const { cards, detachedCard } = useAgentCenterStore.getState();
  return [
    ...new Map(
      [...cards, ...(detachedCard ? [detachedCard] : [])].map((card) => [
        `${card.kind}:${card.id}`,
        card,
      ]),
    ).values(),
  ];
}
export function openedCodexIds() {
  return openedSessions()
    .filter((c) => c.kind === "codex")
    .map((c) => c.id);
}
