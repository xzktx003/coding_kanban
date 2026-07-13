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
                groupId === UNGROUPED_SESSION_GROUP_ID),
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

export function getSessionGroupId(
  session: AgentSessionRecord,
  state: SessionGroupState,
): string {
  const groupId = state.assignments[getSessionGroupKey(session)];
  return state.groups.some((group) => group.id === groupId)
    ? groupId
    : UNGROUPED_SESSION_GROUP_ID;
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
      (collapsedGroupId) => collapsedGroupId !== groupId,
    ),
  };
}

export function isSessionGroupCollapsed(
  state: SessionGroupState,
  groupId: string,
): boolean {
  return state.collapsedGroupIds.includes(groupId);
}

export function toggleSessionGroupCollapsed(
  state: SessionGroupState,
  groupId: string,
): SessionGroupState {
  const collapsed = isSessionGroupCollapsed(state, groupId);
  return {
    ...state,
    collapsedGroupIds: collapsed
      ? state.collapsedGroupIds.filter((item) => item !== groupId)
      : [...state.collapsedGroupIds, groupId],
  };
}

export function assignSessionToGroup(
  state: SessionGroupState,
  sessionKey: string,
  groupId: string | null,
): SessionGroupState {
  const assignments = { ...state.assignments };
  if (
    !groupId ||
    groupId === UNGROUPED_SESSION_GROUP_ID ||
    !state.groups.some((group) => group.id === groupId)
  ) {
    delete assignments[sessionKey];
  } else {
    assignments[sessionKey] = groupId;
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
