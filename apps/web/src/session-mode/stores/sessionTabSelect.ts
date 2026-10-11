import type { AgentCenterCard } from "./useAgentCenterStore";

/** Registered by the session tab actions. Menu reopen uses the same select path. */
let select: ((card: AgentCenterCard) => void | Promise<void>) | null = null;

export function registerSessionTabSelect(
  next: (card: AgentCenterCard) => void | Promise<void>,
) {
  select = next;
  return () => {
    if (select === next) select = null;
  };
}

export function sessionTabSelect(card: AgentCenterCard) {
  return select?.(card);
}
