import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  resolveSessionGroupInlineStyle,
  resolveSessionGroupTone,
} from "./SessionGroupControls";
import {
  groupSessions,
  isSessionGroupCollapsed,
  type SessionGroupState,
} from "../lib/session-groups";

const ALL_SESSIONS_GROUP_ID = "__all_sessions__";
const TERMINAL_SWITCHER_COLLAPSE_SCOPE = "terminal-switcher";

const stateLabels: Record<string, string> = {
  running: "运行中",
  idle: "空闲",
  detached: "已分离",
  exited: "已退出",
};

interface TerminalSessionPlacement {
  monitorIndex: number;
}

export interface TerminalSessionSwitchItem {
  session: AgentSessionRecord;
  selected: boolean;
  occupiedPaneIndex: number | null;
}

export interface TerminalSessionSwitchGroup {
  id: string;
  name: string;
  tone: ReturnType<typeof resolveSessionGroupTone>;
  items: TerminalSessionSwitchItem[];
}

interface BuildTerminalSessionSwitchGroupsOptions {
  sessions: AgentSessionRecord[];
  sessionGroups: SessionGroupState;
  selectedSessionId: string | null;
  placementBySessionId: ReadonlyMap<string, TerminalSessionPlacement>;
  searchQuery?: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function buildTerminalSessionSwitchGroups({
  sessions,
  sessionGroups,
  selectedSessionId,
  placementBySessionId,
  searchQuery = "",
}: BuildTerminalSessionSwitchGroupsOptions): TerminalSessionSwitchGroup[] {
  const grouped =
    sessionGroups.groups.length > 0
      ? groupSessions(sessions, sessionGroups)
      : [
          {
            id: ALL_SESSIONS_GROUP_ID,
            name: "全部会话",
            sessions,
          },
        ];

  const normalizedQuery = normalizeSearchText(searchQuery);

  return grouped
    .map((group) => {
      if (!normalizedQuery) {
        return group;
      }

      const groupMatches = normalizeSearchText(group.name).includes(
        normalizedQuery,
      );
      return {
        ...group,
        sessions: groupMatches
          ? group.sessions
          : group.sessions.filter((session) =>
              normalizeSearchText(session.displayName).includes(
                normalizedQuery,
              ),
            ),
      };
    })
    .filter((group) => group.sessions.length > 0)
    .map((group) => ({
      id: group.id,
      name: group.name,
      tone:
        group.id === ALL_SESSIONS_GROUP_ID
          ? "neutral"
          : resolveSessionGroupTone(
              group.id,
              sessionGroups.groups.findIndex((item) => item.id === group.id),
            ),
      items: group.sessions.map((session) => {
        const selected = session.id === selectedSessionId;
        return {
          session,
          selected,
          occupiedPaneIndex: selected
            ? null
            : (placementBySessionId.get(session.id)?.monitorIndex ?? null),
        };
      }),
    }));
}

interface TerminalSessionSwitcherProps {
  paneIndex: number;
  selectedSessionId: string | null;
  sessions: AgentSessionRecord[];
  sessionGroups: SessionGroupState;
  placementBySessionId: ReadonlyMap<string, TerminalSessionPlacement>;
  onSelect: (sessionId: string) => void;
  onToggleGroup?: (groupId: string, scope?: string) => void;
}

interface SwitcherMenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

function formatSessionMeta(session: AgentSessionRecord): string {
  const transport = session.transportRef?.tmuxSession ? "tmux" : null;
  return [session.agentKind, transport].filter(Boolean).join(" · ");
}

interface TerminalSessionSwitchGroupProps {
  collapsed: boolean;
  collapseDisabled: boolean;
  group: TerminalSessionSwitchGroup;
  groupIndex: number;
  onSelect: (item: TerminalSessionSwitchItem) => void;
  onToggle: () => void;
}

export function TerminalSessionSwitchGroup({
  collapsed,
  collapseDisabled,
  group,
  groupIndex,
  onSelect,
  onToggle,
}: TerminalSessionSwitchGroupProps) {
  return (
    <section
      aria-label={group.name}
      className="terminal-session-switch-group"
      data-collapsed={collapsed ? "true" : "false"}
      data-group-tone={group.tone}
      data-terminal-switch-group-id={group.id}
      role="group"
      style={resolveSessionGroupInlineStyle(group.id, groupIndex, "terminal")}
    >
      <button
        aria-expanded={!collapsed}
        aria-label={
          collapseDisabled
            ? `${group.name}，搜索时保持展开`
            : `${collapsed ? "展开" : "折叠"}分组 ${group.name}`
        }
        className="terminal-session-switch-group-header"
        disabled={collapseDisabled}
        onClick={onToggle}
        title={
          collapseDisabled
            ? "搜索时分组保持展开"
            : collapsed
              ? "展开分组"
              : "折叠分组"
        }
        type="button"
      >
        <span className="terminal-session-switch-group-heading">
          <span
            aria-hidden="true"
            className="terminal-session-switch-group-chevron"
          />
          <span>{group.name}</span>
        </span>
        <strong>{group.items.length}</strong>
      </button>
      {!collapsed && (
        <div className="terminal-session-switch-group-items">
          {group.items.map((item) => {
            const stateLabel =
              stateLabels[item.session.interactionState] ??
              item.session.interactionState;
            return (
              <button
                key={item.session.id}
                aria-selected={item.selected}
                className="terminal-session-switch-option"
                data-session-state={item.session.interactionState}
                data-terminal-switch-session-id={item.session.id}
                disabled={item.occupiedPaneIndex !== null}
                onClick={() => onSelect(item)}
                role="option"
                type="button"
              >
                <span
                  aria-label={stateLabel}
                  className="terminal-session-switch-status"
                />
                <span className="terminal-session-switch-identity">
                  <strong>{item.session.displayName}</strong>
                  <small>{formatSessionMeta(item.session)}</small>
                </span>
                <span className="terminal-session-switch-badges">
                  {item.selected && <span>当前</span>}
                  {item.occupiedPaneIndex !== null && (
                    <span>窗格 {item.occupiedPaneIndex}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TerminalSessionSwitcher({
  paneIndex,
  selectedSessionId,
  sessions,
  sessionGroups,
  placementBySessionId,
  onSelect,
  onToggleGroup,
}: TerminalSessionSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<SwitcherMenuPosition | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const groups = buildTerminalSessionSwitchGroups({
    sessions,
    sessionGroups,
    selectedSessionId,
    placementBySessionId,
    searchQuery,
  });
  const visibleSessionCount = groups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 6;
      const availableWidth = Math.max(
        240,
        window.innerWidth - viewportPadding * 2,
      );
      const width = Math.min(
        Math.max(Math.min(rect.width, 420), 320),
        availableWidth,
      );
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      );
      const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
      const roomAbove = rect.top - viewportPadding;
      const openAbove = roomBelow < 300 && roomAbove > roomBelow;
      const maxHeight = Math.max(
        180,
        Math.min(460, openAbove ? roomAbove - gap : roomBelow - gap),
      );

      setMenuPosition({
        left,
        width,
        maxHeight,
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuPosition) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        return;
      }

      const preferred = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="option"][aria-selected="true"]',
      );
      const fallback = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      );
      (preferred ?? fallback)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menuPosition, open]);

  function openMenu() {
    setSearchQuery("");
    setMenuPosition(null);
    setOpen(true);
  }

  function selectSession(sessionId: string) {
    setOpen(false);
    onSelect(sessionId);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const options = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      ) ?? [],
    );
    if (options.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowUp"
            ? currentIndex < 0
              ? options.length - 1
              : (currentIndex - 1 + options.length) % options.length
            : currentIndex < 0
              ? 0
              : (currentIndex + 1) % options.length;
    options[nextIndex]?.focus();
  }

  const menuStyle = menuPosition
    ? ({
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        top: menuPosition.top,
        bottom: menuPosition.bottom,
      } satisfies CSSProperties)
    : undefined;

  return (
    <div
      className="terminal-session-switcher"
      draggable={false}
      onDragStart={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`选择第 ${paneIndex} 个监控终端`}
        className="terminal-session-switcher-trigger"
        data-testid={`terminal-session-switcher-${paneIndex}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        type="button"
      >
        <span className="terminal-session-switcher-current">
          {selectedSession?.displayName ?? "无可用会话"}
        </span>
        <span aria-hidden="true" className="terminal-session-switcher-chevron">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            aria-label={`切换第 ${paneIndex} 个监控终端`}
            className="terminal-session-switcher-menu"
            data-positioned={menuPosition ? "true" : "false"}
            id={menuId}
            onKeyDown={handleMenuKeyDown}
            role="dialog"
            style={menuStyle}
          >
            <div className="terminal-session-switcher-menu-header">
              <div className="terminal-session-switcher-menu-title-row">
                <div>
                  <span className="terminal-session-switcher-kicker">
                    终端窗格 {paneIndex}
                  </span>
                  <strong>切换会话</strong>
                </div>
                <div className="terminal-session-switcher-menu-meta">
                  <span>{groups.length} 组</span>
                  <span>
                    {searchQuery
                      ? `${visibleSessionCount} 个结果`
                      : `${sessions.length} 个会话`}
                  </span>
                  <button
                    aria-label="关闭会话切换列表"
                    onClick={() => {
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="terminal-session-switcher-search">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchInputRef}
                  aria-label="搜索会话或分组"
                  autoComplete="off"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      triggerRef.current?.focus();
                      return;
                    }

                    if (event.key !== "Enter") {
                      return;
                    }

                    const firstSelectable = groups
                      .flatMap((group) => group.items)
                      .find((item) => item.occupiedPaneIndex === null);
                    if (firstSelectable && visibleSessionCount === 1) {
                      event.preventDefault();
                      if (firstSelectable.selected) {
                        setOpen(false);
                        triggerRef.current?.focus();
                      } else {
                        selectSession(firstSelectable.session.id);
                      }
                    }
                  }}
                  placeholder="搜索会话名或分组名"
                  role="searchbox"
                  type="search"
                  value={searchQuery}
                />
                {searchQuery && (
                  <button
                    aria-label="清除会话搜索"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    type="button"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div
              aria-label={`第 ${paneIndex} 个终端可选会话`}
              className="terminal-session-switcher-groups"
              role="listbox"
            >
              {groups.length === 0 ? (
                <div className="terminal-session-switcher-empty" role="status">
                  未找到匹配的会话或分组
                </div>
              ) : (
                groups.map((group) => {
                  const collapseDisabled = Boolean(searchQuery);
                  const collapsed =
                    !collapseDisabled &&
                    isSessionGroupCollapsed(
                      sessionGroups,
                      group.id,
                      TERMINAL_SWITCHER_COLLAPSE_SCOPE,
                    );
                  return (
                    <TerminalSessionSwitchGroup
                      key={group.id}
                      collapsed={collapsed}
                      collapseDisabled={collapseDisabled}
                      group={group}
                      groupIndex={sessionGroups.groups.findIndex(
                        (item) => item.id === group.id,
                      )}
                      onSelect={(item) => {
                        if (item.selected) {
                          setOpen(false);
                          triggerRef.current?.focus();
                          return;
                        }
                        selectSession(item.session.id);
                      }}
                      onToggle={() =>
                        onToggleGroup?.(
                          group.id,
                          TERMINAL_SWITCHER_COLLAPSE_SCOPE,
                        )
                      }
                    />
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
