import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export type AgentGridSortMode = "recent" | "project" | "name";

export const AGENT_GRID_SORT_STORAGE_KEY = "coding-kanban-agent-grid-sort-v1";

const DEFAULT_SORT_MODE: AgentGridSortMode = "recent";

export function loadAgentGridSortMode(): AgentGridSortMode {
  try {
    const value = localStorage.getItem(AGENT_GRID_SORT_STORAGE_KEY);
    return value === "project" || value === "name" || value === "recent"
      ? value
      : DEFAULT_SORT_MODE;
  } catch {
    return DEFAULT_SORT_MODE;
  }
}

export function saveAgentGridSortMode(mode: AgentGridSortMode): void {
  try {
    localStorage.setItem(AGENT_GRID_SORT_STORAGE_KEY, mode);
  } catch {
    // Sorting is optional UI state; storage failures must not block the board.
  }
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestActivity(session: AgentSessionRecord): number {
  return Math.max(
    timestampValue(session.lastOutputAt),
    timestampValue(session.lastHeartbeatAt),
    timestampValue(session.lastRefreshedAt),
  );
}

function projectLabel(session: AgentSessionRecord): string {
  return (
    session.projectName ??
    session.repositoryRoot ??
    session.workingDirectory ??
    ""
  );
}

export function sortAgentSessions(
  sessions: AgentSessionRecord[],
  mode: AgentGridSortMode,
): AgentSessionRecord[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      let comparison = 0;
      if (mode === "recent") {
        comparison = latestActivity(right.session) - latestActivity(left.session);
      } else if (mode === "project") {
        comparison = projectLabel(left.session).localeCompare(
          projectLabel(right.session),
          undefined,
          { sensitivity: "base", numeric: true },
        );
      } else {
        comparison = left.session.displayName.localeCompare(
          right.session.displayName,
          undefined,
          { sensitivity: "base", numeric: true },
        );
      }

      if (comparison !== 0) return comparison;
      if (mode === "recent") return left.index - right.index;
      const nameComparison = left.session.displayName.localeCompare(
        right.session.displayName,
        undefined,
        { sensitivity: "base", numeric: true },
      );
      return nameComparison !== 0
        ? nameComparison
        : left.index - right.index;
    })
    .map(({ session }) => session);
}
