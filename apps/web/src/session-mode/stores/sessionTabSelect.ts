import type { AgentCenterCard } from "./useAgentCenterStore";

/** Registered by the session tab actions. Menu reopen uses the same select path. */
const selectors: Array<{
  select: (card: AgentCenterCard) => void | Promise<void>;
}> = [];

export function registerSessionTabSelect(
  next: (card: AgentCenterCard) => void | Promise<void>,
) {
  const registration = { select: next };
  selectors.push(registration);
  return () => {
    const index = selectors.indexOf(registration);
    if (index >= 0) selectors.splice(index, 1);
  };
}

export function sessionTabSelect(card: AgentCenterCard) {
  return selectors.at(-1)?.select(card);
}
export const canSelectSessionTab = () => selectors.length > 0;
