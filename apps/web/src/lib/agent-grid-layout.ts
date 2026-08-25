export type AgentGridLayoutMode = "status" | "group";

export const AGENT_GRID_LAYOUT_STORAGE_KEY =
  "coding-kanban-agent-grid-layout-v1";

const DEFAULT_LAYOUT_MODE: AgentGridLayoutMode = "status";

export function loadAgentGridLayoutMode(): AgentGridLayoutMode {
  try {
    const value = localStorage.getItem(AGENT_GRID_LAYOUT_STORAGE_KEY);
    return value === "group" || value === "status"
      ? value
      : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

export function saveAgentGridLayoutMode(mode: AgentGridLayoutMode): void {
  try {
    localStorage.setItem(AGENT_GRID_LAYOUT_STORAGE_KEY, mode);
  } catch {
    // Layout is optional UI state; storage failures must not block the board.
  }
}
