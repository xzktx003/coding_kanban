import type { CSSProperties } from "react";

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

const SESSION_GROUP_TONES = [
  "amber",
  "teal",
  "sky",
  "coral",
  "violet",
  "lime",
  "rose",
  "cyan",
  "gold",
  "emerald",
  "indigo",
  "magenta",
] as const;

const SESSION_GROUP_HUE_OFFSET = 28;
const SESSION_GROUP_HUE_STEP = 137.508;

export type SessionGroupTone = (typeof SESSION_GROUP_TONES)[number] | "neutral";

export function resolveSessionGroupTone(
  groupId: string,
  groupIndex?: number,
): SessionGroupTone {
  if (groupId === UNGROUPED_SESSION_GROUP_ID) {
    return "neutral";
  }

  if (
    groupIndex !== undefined &&
    Number.isInteger(groupIndex) &&
    groupIndex >= 0
  ) {
    return SESSION_GROUP_TONES[groupIndex % SESSION_GROUP_TONES.length]!;
  }

  let hash = 0;
  for (const character of groupId) {
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return SESSION_GROUP_TONES[hash % SESSION_GROUP_TONES.length];
}

export function resolveSessionGroupInlineStyle(
  groupId: string,
  groupIndex?: number,
  target: "session" | "terminal" = "session",
): CSSProperties | undefined {
  if (
    groupId === UNGROUPED_SESSION_GROUP_ID ||
    groupIndex === undefined ||
    !Number.isInteger(groupIndex) ||
    groupIndex < 0
  ) {
    return undefined;
  }

  const hue =
    (SESSION_GROUP_HUE_OFFSET + groupIndex * SESSION_GROUP_HUE_STEP) % 360;
  const prefix =
    target === "terminal" ? "--terminal-switch-group" : "--session-group";

  return {
    [`${prefix}-accent`]: `hsl(${hue.toFixed(3)} 88% 74%)`,
    [`${prefix}-border`]: `hsl(${hue.toFixed(3)} 86% 68% / 0.38)`,
    [`${prefix}-surface`]: `hsl(${hue.toFixed(3)} 88% 60% / 0.12)`,
  } as CSSProperties;
}

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
  groupIndex?: number;
  name: string;
  count: number;
  compact?: boolean;
  collapsed?: boolean;
  onDeleteGroup?: (groupId: string) => void;
  onRenameGroup?: (groupId: string) => void;
  onToggleGroup?: (groupId: string) => void;
}

export function SessionGroupHeader({
  groupId,
  groupIndex,
  name,
  count,
  compact = false,
  collapsed = false,
  onDeleteGroup,
  onRenameGroup,
  onToggleGroup,
}: SessionGroupHeaderProps) {
  const editable = groupId !== UNGROUPED_SESSION_GROUP_ID;
  const tone = resolveSessionGroupTone(groupId, groupIndex);
  const colorStyle = resolveSessionGroupInlineStyle(groupId, groupIndex);

  return (
    <div
      className={`session-group-header${compact ? " session-group-header--compact" : ""}`}
      data-collapsed={collapsed ? "true" : "false"}
      data-group-tone={tone}
      data-session-group-id={groupId}
      style={colorStyle}
    >
      <button
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "展开" : "折叠"}分组 ${name}`}
        className="session-group-toggle"
        onClick={() => onToggleGroup?.(groupId)}
        title={collapsed ? "展开分组" : "折叠分组"}
        type="button"
      >
        <span aria-hidden="true" className="session-group-chevron">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="session-group-heading">
          <span className="session-group-name">{name}</span>
          <span className="session-group-count">{count}</span>
        </span>
      </button>
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
