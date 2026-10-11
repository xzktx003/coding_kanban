import type { AgentCenterCard } from "./useAgentCenterStore";

/** Recently closed session tabs. Closing still does not stop the Agent. */
const closed: AgentCenterCard[] = [];

export function rememberClosedTab(card: AgentCenterCard) {
  const key = `${card.kind}:${card.id}`;
  const next = closed.filter((item) => `${item.kind}:${item.id}` !== key);
  next.push(card);
  closed.splice(0, closed.length, ...next.slice(-12));
}

export function takeClosedTab() {
  return closed.pop() ?? null;
}

export function resetClosedTabs() {
  closed.length = 0;
}
