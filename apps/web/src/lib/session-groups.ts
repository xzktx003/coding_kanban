import type { AgentSessionRecord } from "@agent-orchestrator/shared";

export const UNGROUPED_SESSION_GROUP_ID = "__ungrouped__";

const SESSION_GROUP_STORAGE_KEY = "coding-kanban-session-groups-v1";

export interface SessionGroup {
  id: string;
  name: string;
}

export interface SessionGroupState {
  groups: SessionGroup[];
  assignments: Record<string, string>;
  collapsedGroupIds: string[];
}

export interface GroupedSessions extends SessionGroup {
  sessions: AgentSessionRecord[];
}

export type SessionGroupCollapseScope = string;

export function getSessionGroupCollapseKey(
  groupId: string,
  scope?: SessionGroupCollapseScope,
): string {
  return scope ? `kanban:${scope}:${groupId}` : groupId;
}

function isCollapseKeyForGroup(collapseKey: string, groupId: string): boolean {
  return collapseKey === groupId || collapseKey.endsWith(`:${groupId}`);
}

const EMPTY_SESSION_GROUP_STATE: SessionGroupState = {
  groups: [],
  assignments: {},
  collapsedGroupIds: [],
};

function normalizeSessionGroups(value: unknown): SessionGroupState {
  if (!value || typeof value !== "object") {
    return EMPTY_SESSION_GROUP_STATE;
  }

  const candidate = value as Partial<SessionGroupState>;
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups.filter(
        (group): group is SessionGroup =>
          Boolean(group) &&
          typeof group.id === "string" &&
          group.id !== UNGROUPED_SESSION_GROUP_ID &&
          typeof group.name === "string" &&
          Boolean(group.name.trim()),
      )
    : [];
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const assignments =
    candidate.assignments && typeof candidate.assignments === "object"
      ? Object.fromEntries(
          Object.entries(candidate.assignments).filter(
            ([sessionKey, groupId]) =>
              Boolean(sessionKey) &&
              typeof groupId === "string" &&
              knownGroupIds.has(groupId),
          ),
        )
      : {};
  const collapsedGroupIds = Array.isArray(candidate.collapsedGroupIds)
    ? [
        ...new Set(
          candidate.collapsedGroupIds.filter(
            (groupId): groupId is string =>
              typeof groupId === "string" &&
              (knownGroupIds.has(groupId) ||
                groupId === UNGROUPED_SESSION_GROUP_ID ||
                [...knownGroupIds, UNGROUPED_SESSION_GROUP_ID].some(
                  (knownGroupId) =>
                    isCollapseKeyForGroup(groupId, knownGroupId),
                )),
          ),
        ),
      ]
    : [];

  return { groups, assignments, collapsedGroupIds };
}

export function loadSessionGroups(): SessionGroupState {
  try {
    const raw = localStorage.getItem(SESSION_GROUP_STORAGE_KEY);
    return raw
      ? normalizeSessionGroups(JSON.parse(raw))
      : EMPTY_SESSION_GROUP_STATE;
  } catch {
    return EMPTY_SESSION_GROUP_STATE;
  }
}

export function saveSessionGroups(state: SessionGroupState): void {
  try {
    localStorage.setItem(
      SESSION_GROUP_STORAGE_KEY,
      JSON.stringify(normalizeSessionGroups(state)),
    );
  } catch {
    // Grouping is optional UI state; storage failures must not block sessions.
  }
}

export function getSessionGroupKey(session: AgentSessionRecord): string {
  if (session.agentSessionId) {
    return `agent-session:${session.agentSessionId}`;
  }

  if (session.transportRef?.tmuxPane) {
    const sshHost = session.sshTarget?.host ?? session.transportRef.sshHost;
    if (sshHost) {
      const sshUsername =
        session.sshTarget?.username ??
        session.transportRef.sshUsername ??
        "default";
      const sshPort =
        session.sshTarget?.port ?? session.transportRef.sshPort ?? 22;
      return `tmux-pane:ssh:${sshUsername}@${sshHost}:${sshPort}:${session.transportRef.tmuxPane}`;
    }

    const host = session.hostId ?? "local";
    return `tmux-pane:${host}:${session.transportRef.tmuxPane}`;
  }

  return `session:${session.id}`;
}

function getTmuxSessionScope(session: AgentSessionRecord): string {
  const sshHost = session.sshTarget?.host ?? session.transportRef?.sshHost;
  if (sshHost) {
    const sshUsername =
      session.sshTarget?.username ??
      session.transportRef?.sshUsername ??
      "default";
    const sshPort =
      session.sshTarget?.port ?? session.transportRef?.sshPort ?? 22;
    return `ssh:${sshUsername}@${sshHost}:${sshPort}`;
  }

  return session.hostId ?? "local";
}

/**
 * Return every durable identity currently available for a session.
 *
 * The browser grouping state outlives PTY runtimes. Keeping aliases lets a
 * restored session retain its assignment when a runtime/agent id or tmux pane
 * identity changes between snapshots.
 */
export function getSessionGroupKeys(session: AgentSessionRecord): string[] {
  // The registry id survives managed-session restores and is the strongest
  // identity. Runtime aliases remain useful for legacy browser assignments.
  const keys = [`session:${session.id}`, getSessionGroupKey(session)];

  if (session.agentSessionId) {
    keys.push(`agent-session:${session.agentSessionId}`);
  }

  const tmuxSession = session.transportRef?.tmuxSession;
  // A session-level alias is safe only when there is no pane identity. When
  // several panes from one tmux session are displayed, sharing this alias
  // would incorrectly move all panes into one group.
  if (tmuxSession && !session.transportRef?.tmuxPane) {
    keys.push(
      `tmux-session:${getTmuxSessionScope(session)}:${tmuxSession}`,
    );
  }

  return [...new Set(keys)];
}

export function getSessionGroupId(
  session: AgentSessionRecord,
  state: SessionGroupState,
): string {
  const groupIds = new Set(state.groups.map((group) => group.id));
  for (const sessionKey of getSessionGroupKeys(session)) {
    const groupId = state.assignments[sessionKey];
    if (groupId && groupIds.has(groupId)) {
      return groupId;
    }
  }

  return UNGROUPED_SESSION_GROUP_ID;
}

export function addSessionGroup(
  state: SessionGroupState,
  group: SessionGroup,
): SessionGroupState {
  const name = group.name.trim();
  if (
    !name ||
    group.id === UNGROUPED_SESSION_GROUP_ID ||
    state.groups.some(
      (existing) =>
        existing.id === group.id ||
        existing.name.localeCompare(name, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    return state;
  }

  return {
    ...state,
    groups: [...state.groups, { id: group.id, name }],
  };
}

export function renameSessionGroup(
  state: SessionGroupState,
  groupId: string,
  name: string,
): SessionGroupState {
  const trimmedName = name.trim();
  if (
    !trimmedName ||
    state.groups.some(
      (group) =>
        group.id !== groupId &&
        group.name.localeCompare(trimmedName, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id === groupId ? { ...group, name: trimmedName } : group,
    ),
  };
}

export function deleteSessionGroup(
  state: SessionGroupState,
  groupId: string,
): SessionGroupState {
  const groups = state.groups.filter((group) => group.id !== groupId);
  if (groups.length === state.groups.length) {
    return state;
  }

  return {
    ...state,
    groups,
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(
        ([, assignedGroupId]) => assignedGroupId !== groupId,
      ),
    ),
    collapsedGroupIds: state.collapsedGroupIds.filter(
      (collapsedGroupId) =>
        !isCollapseKeyForGroup(collapsedGroupId, groupId),
    ),
  };
}

export function isSessionGroupCollapsed(
  state: SessionGroupState,
  groupId: string,
  scope?: SessionGroupCollapseScope,
): boolean {
  return state.collapsedGroupIds.includes(
    getSessionGroupCollapseKey(groupId, scope),
  );
}

export function toggleSessionGroupCollapsed(
  state: SessionGroupState,
  groupId: string,
  scope?: SessionGroupCollapseScope,
): SessionGroupState {
  const collapseKey = getSessionGroupCollapseKey(groupId, scope);
  const collapsed = isSessionGroupCollapsed(state, groupId, scope);
  return {
    ...state,
    collapsedGroupIds: collapsed
      ? state.collapsedGroupIds.filter((item) => item !== collapseKey)
      : [...state.collapsedGroupIds, collapseKey],
  };
}

export function assignSessionToGroup(
  state: SessionGroupState,
  sessionKey: string | readonly string[],
  groupId: string | null,
): SessionGroupState {
  const assignments = { ...state.assignments };
  const sessionKeys = Array.isArray(sessionKey) ? sessionKey : [sessionKey];
  if (
    !groupId ||
    groupId === UNGROUPED_SESSION_GROUP_ID ||
    !state.groups.some((group) => group.id === groupId)
  ) {
    sessionKeys.forEach((key) => delete assignments[key]);
  } else {
    sessionKeys.forEach((key) => {
      assignments[key] = groupId;
    });
  }

  return { ...state, assignments };
}

export function groupSessions(
  sessions: AgentSessionRecord[],
  state: SessionGroupState,
): GroupedSessions[] {
  const grouped: GroupedSessions[] = state.groups.map((group) => ({
    ...group,
    sessions: [],
  }));
  const groupedById = new Map(grouped.map((group) => [group.id, group]));
  const ungrouped: AgentSessionRecord[] = [];

  for (const session of sessions) {
    const group = groupedById.get(getSessionGroupId(session, state));
    if (group) {
      group.sessions.push(session);
    } else {
      ungrouped.push(session);
    }
  }

  if (ungrouped.length > 0) {
    grouped.push({
      id: UNGROUPED_SESSION_GROUP_ID,
      name: "未分组",
      sessions: ungrouped,
    });
  }

  return grouped;
}
