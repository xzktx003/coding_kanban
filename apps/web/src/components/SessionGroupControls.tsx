import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  getSessionGroupId,
  UNGROUPED_SESSION_GROUP_ID,
  type SessionGroupState,
} from "../lib/session-groups";

interface SessionGroupMenuProps {
  session: AgentSessionRecord;
  sessionGroups: SessionGroupState;
  onCreateGroup?: (sessionId?: string) => void;
  onMoveSessionToGroup?: (sessionId: string, groupId: string | null) => void;
}

export type SessionGroupSelectionAction =
  | { type: "create" }
  | { type: "move"; groupId: string | null };

export function resolveSessionGroupSelection(
  value: string,
): SessionGroupSelectionAction {
  if (value === "__create__") {
    return { type: "create" };
  }

  return {
    type: "move",
    groupId: value === UNGROUPED_SESSION_GROUP_ID ? null : value,
  };
}

export function SessionGroupMenu({
  session,
  sessionGroups,
  onCreateGroup,
  onMoveSessionToGroup,
}: SessionGroupMenuProps) {
  const currentGroupId = getSessionGroupId(session, sessionGroups);

  return (
    <div className="session-group-menu">
      <select
        aria-label="移动到分组"
        className="session-group-menu-select"
        onChange={(event) => {
          event.stopPropagation();
          const action = resolveSessionGroupSelection(event.target.value);
          if (action.type === "create") {
            onCreateGroup?.(session.id);
            return;
          }
          onMoveSessionToGroup?.(session.id, action.groupId);
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onDragStart={(event) => event.stopPropagation()}
        title="移动到分组"
        value={currentGroupId}
      >
        <option value={UNGROUPED_SESSION_GROUP_ID}>未分组</option>
        {sessionGroups.groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
        <option disabled>────────</option>
        <option value="__create__">＋ 新建分组</option>
      </select>
    </div>
  );
}

interface SessionGroupHeaderProps {
  groupId: string;
  name: string;
  count: number;
  compact?: boolean;
  onDeleteGroup?: (groupId: string) => void;
  onRenameGroup?: (groupId: string) => void;
}

export function SessionGroupHeader({
  groupId,
  name,
  count,
  compact = false,
  onDeleteGroup,
  onRenameGroup,
}: SessionGroupHeaderProps) {
  const editable = groupId !== UNGROUPED_SESSION_GROUP_ID;

  return (
    <div
      className={`session-group-header${compact ? " session-group-header--compact" : ""}`}
      data-session-group-id={groupId}
    >
      <div className="session-group-heading">
        <span className="session-group-name">{name}</span>
        <span className="session-group-count">{count}</span>
      </div>
      {editable && (
        <div className="session-group-header-actions">
          <button
            aria-label={`重命名分组 ${name}`}
            onClick={() => onRenameGroup?.(groupId)}
            title="重命名分组"
            type="button"
          >
            ✎
          </button>
          <button
            aria-label={`删除分组 ${name}`}
            onClick={() => onDeleteGroup?.(groupId)}
            title="删除分组"
            type="button"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
