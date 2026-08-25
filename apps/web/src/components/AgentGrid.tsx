import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  AGENT_GRID_CARD_HEIGHT,
  AGENT_GRID_GAP,
  AGENT_GRID_VIRTUALIZATION_THRESHOLD,
  computeVirtualGridWindow,
} from "../lib/grid-virtualization";
import { AgentGridCard } from "./AgentGridCard";
import { FilterBar, type FilterState } from "./FilterBar";
import { SessionGroupHeader } from "./SessionGroupControls";
import {
  type AgentGridSortMode,
  sortAgentSessions,
} from "../lib/agent-grid-sort";
import type { AgentGridLayoutMode } from "../lib/agent-grid-layout";
import {
  groupSessions,
  isSessionGroupCollapsed,
  type SessionGroupState,
} from "../lib/session-groups";

interface AgentGridProps {
  sessions: AgentSessionRecord[];
  allSessions: AgentSessionRecord[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onFocusSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onReconnectSession: (id: string) => void;
  onRenameSession?: (id: string) => void;
  onHideSession?: (id: string) => void;
  onCopyConnectCommand?: (id: string) => void;
  onKillTmux?: (id: string) => void;
  onNewSession?: () => void;
  onScanTmux?: () => void;
  suspendedSessionId?: string | null;
  hiddenCount?: number;
  onShowHidden?: () => void;
  useLightweightTerminalPreview?: boolean;
  terminalFontSize?: number;
  onTerminalFontSizeChange?: (fontSize: number) => void;
  sessionGroups?: SessionGroupState;
  onCreateSessionGroup?: (sessionId?: string) => void;
  onDeleteSessionGroup?: (groupId: string) => void;
  onMoveSessionToGroup?: (sessionId: string, groupId: string | null) => void;
  onRenameSessionGroup?: (groupId: string) => void;
  onToggleSessionGroup?: (groupId: string, scope?: string) => void;
  onUnreadCompletionChange?: (id: string, unread: boolean) => void;
  layoutMode?: AgentGridLayoutMode;
  onLayoutModeChange?: (mode: AgentGridLayoutMode) => void;
  sortMode?: AgentGridSortMode;
  onSortModeChange?: (mode: AgentGridSortMode) => void;
}

type AgentKanbanColumnId = "response" | "executing" | "review" | "ready";

interface GridMetrics {
  width: number;
  height: number;
  scrollTop: number;
  columnContentTops: Record<AgentKanbanColumnId, number>;
}

interface AgentKanbanColumn {
  id: AgentKanbanColumnId;
  label: string;
  emptyLabel: string;
  sessions: AgentSessionRecord[];
}

const agentKanbanColumnDefinitions: Array<Omit<AgentKanbanColumn, "sessions">> =
  [
    { id: "response", label: "需响应", emptyLabel: "暂无等待响应的会话" },
    { id: "executing", label: "执行中", emptyLabel: "暂无执行中的会话" },
    { id: "review", label: "待验收", emptyLabel: "暂无待验收结果" },
    { id: "ready", label: "可继续", emptyLabel: "暂无可继续会话" },
  ];

const defaultGridMetrics: GridMetrics = {
  width: 0,
  height: 0,
  scrollTop: 0,
  columnContentTops: {
    response: 0,
    executing: 0,
    review: 0,
    ready: 0,
  },
};

function readGridMetrics(element: HTMLDivElement): GridMetrics {
  const boardRect = element.getBoundingClientRect();
  const columnContentTops = Object.fromEntries(
    agentKanbanColumnDefinitions.map((column) => {
      const content = element.querySelector<HTMLElement>(
        `[data-kanban-column-content="${column.id}"]`,
      );
      const contentTop = content
        ? content.getBoundingClientRect().top -
          boardRect.top +
          element.scrollTop
        : 0;
      return [column.id, Math.max(0, contentTop)];
    }),
  ) as Record<AgentKanbanColumnId, number>;

  return {
    width: element.clientWidth,
    height: element.clientHeight,
    scrollTop: element.scrollTop,
    columnContentTops,
  };
}

function sameGridMetrics(a: GridMetrics, b: GridMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.scrollTop === b.scrollTop &&
    agentKanbanColumnDefinitions.every(
      (column) =>
        a.columnContentTops[column.id] === b.columnContentTops[column.id],
    )
  );
}

export function getAgentKanbanColumnScrollTop(
  boardScrollTop: number,
  columnContentTop: number,
): number {
  return Math.max(0, boardScrollTop - columnContentTop);
}

export function getAgentKanbanColumnId(
  session: AgentSessionRecord,
): AgentKanbanColumnId {
  if (session.interactionState === "awaiting_input") {
    return "response";
  }

  if (session.interactionState === "running") {
    return "executing";
  }

  if (session.hasUnreadCompletion) {
    return "review";
  }

  return "ready";
}

export function buildAgentKanbanColumns(
  sessions: AgentSessionRecord[],
  sortMode: AgentGridSortMode = "recent",
): AgentKanbanColumn[] {
  const sessionsByColumn: Record<AgentKanbanColumnId, AgentSessionRecord[]> = {
    response: [],
    executing: [],
    review: [],
    ready: [],
  };

  for (const session of sessions) {
    sessionsByColumn[getAgentKanbanColumnId(session)].push(session);
  }

  return agentKanbanColumnDefinitions.map((column) => ({
    ...column,
    sessions: sortAgentSessions(sessionsByColumn[column.id], sortMode),
  }));
}

export function AgentGrid({
  sessions,
  allSessions,
  filters,
  onFiltersChange,
  onFocusSession,
  onDeleteSession,
  onReconnectSession,
  onRenameSession,
  onHideSession,
  onCopyConnectCommand,
  onKillTmux,
  onNewSession,
  onScanTmux,
  suspendedSessionId,
  hiddenCount = 0,
  onShowHidden,
  useLightweightTerminalPreview = true,
  terminalFontSize,
  onTerminalFontSizeChange,
  sessionGroups = { groups: [], assignments: {}, collapsedGroupIds: [] },
  onCreateSessionGroup,
  onDeleteSessionGroup,
  onMoveSessionToGroup,
  onRenameSessionGroup,
  onToggleSessionGroup,
  onUnreadCompletionChange,
  layoutMode = "status",
  onLayoutModeChange,
  sortMode = "recent",
  onSortModeChange,
}: AgentGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [gridMetrics, setGridMetrics] =
    useState<GridMetrics>(defaultGridMetrics);
  const groupingEnabled = sessionGroups.groups.length > 0;
  const kanbanColumns = useMemo(
    () => buildAgentKanbanColumns(sessions, sortMode),
    [sessions, sortMode],
  );
  const groupedBoardSessions = useMemo(
    () => groupSessions(sortAgentSessions(sessions, sortMode), sessionGroups),
    [sessionGroups, sessions, sortMode],
  );
  const kanbanColumnSizeKey = kanbanColumns
    .map((column) => column.sessions.length)
    .join(":");
  const shouldVirtualize =
    layoutMode === "status" &&
    !groupingEnabled &&
    sessions.length > AGENT_GRID_VIRTUALIZATION_THRESHOLD;

  const updateGridMetrics = useCallback(() => {
    const element = gridRef.current;
    if (!element) return;

    const nextMetrics = readGridMetrics(element);
    setGridMetrics((current) =>
      sameGridMetrics(current, nextMetrics) ? current : nextMetrics,
    );
  }, []);

  useEffect(() => {
    if (!shouldVirtualize) {
      setGridMetrics(defaultGridMetrics);
      return;
    }

    const element = gridRef.current;
    if (!element) return;

    updateGridMetrics();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateGridMetrics);
      return () => window.removeEventListener("resize", updateGridMetrics);
    }

    const resizeObserver = new ResizeObserver(updateGridMetrics);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [shouldVirtualize, updateGridMetrics]);

  useEffect(() => {
    if (!shouldVirtualize) return;
    updateGridMetrics();
  }, [kanbanColumnSizeKey, shouldVirtualize, updateGridMetrics]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  const handleGridScroll = useCallback(() => {
    if (!shouldVirtualize || scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = gridRef.current;
      if (!element) return;

      setGridMetrics((current) =>
        current.scrollTop === element.scrollTop
          ? current
          : { ...current, scrollTop: element.scrollTop },
      );
    });
  }, [shouldVirtualize]);

  const gridStyle = shouldVirtualize
    ? ({
        "--agent-grid-card-height": `${AGENT_GRID_CARD_HEIGHT}px`,
      } as CSSProperties)
    : undefined;

  function renderSessionCard(session: AgentSessionRecord) {
    return (
      <AgentGridCard
        key={session.id}
        session={session}
        onDoubleClick={onFocusSession}
        onDelete={onDeleteSession}
        onReconnect={onReconnectSession}
        onRename={onRenameSession}
        onHide={onHideSession}
        onCopyConnectCommand={onCopyConnectCommand}
        onKillTmux={onKillTmux}
        onUnreadCompletionChange={onUnreadCompletionChange}
        sessionGroups={sessionGroups}
        onCreateSessionGroup={onCreateSessionGroup}
        onMoveSessionToGroup={onMoveSessionToGroup}
        terminalSuspended={session.id === suspendedSessionId}
        useLightweightTerminalPreview={useLightweightTerminalPreview}
        terminalFontSize={terminalFontSize}
        onTerminalFontSizeChange={onTerminalFontSizeChange}
      />
    );
  }

  return (
    <div className="agent-grid-container">
      <div className="agent-grid-toolbar">
        <FilterBar
          sessions={allSessions}
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
        <div className="agent-grid-toolbar-actions">
          <div
            aria-label="宫格分区方式"
            className="agent-grid-layout-switch"
            role="group"
          >
            <button
              aria-pressed={layoutMode === "status"}
              onClick={() => onLayoutModeChange?.("status")}
              type="button"
            >
              按状态
            </button>
            <button
              aria-pressed={layoutMode === "group"}
              onClick={() => onLayoutModeChange?.("group")}
              type="button"
            >
              按分组
            </button>
          </div>
          <label className="agent-grid-sort-control">
            <span>排序</span>
            <select
              aria-label="看板排序"
              value={sortMode}
              onChange={(event) =>
                onSortModeChange?.(event.target.value as AgentGridSortMode)
              }
            >
              <option value="recent">最近活动</option>
              <option value="project">项目</option>
              <option value="name">名称</option>
            </select>
          </label>
          <button
            className="session-group-add-button"
            onClick={() => onCreateSessionGroup?.()}
            type="button"
          >
            ＋ 新建分组
          </button>
          {hiddenCount > 0 && (
            <button
              className="hidden-sessions-btn"
              onClick={onShowHidden}
              type="button"
            >
              已隐藏 ({hiddenCount})
            </button>
          )}
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="grid-empty grid-empty--with-actions">
          <p>
            {allSessions.length > 0
              ? "没有匹配的会话，试试调整筛选条件"
              : "暂无 Agent 会话"}
          </p>
          {allSessions.length === 0 && (
            <div className="grid-empty-actions">
              <p className="grid-empty-hint">
                点击左侧面板启动或扫描 Agent，也可以使用下方快捷入口
              </p>
              <div className="grid-empty-quickstart">
                <div className="grid-empty-quickstart-step">
                  <span className="grid-empty-step-num">1</span>
                  <span>新建一个 Copilot / Codex / Claude 会话</span>
                </div>
                <div className="grid-empty-quickstart-step">
                  <span className="grid-empty-step-num">2</span>
                  <span>双击卡片进入聚焦视图开始输入</span>
                </div>
                <div className="grid-empty-quickstart-step">
                  <span className="grid-empty-step-num">3</span>
                  <span>
                    使用 <kbd>Alt+Q</kbd> 返回宫格，<kbd>Ctrl+E</kbd> 快连 tmux
                  </span>
                </div>
              </div>
              <div className="grid-empty-buttons">
                {onNewSession && (
                  <button
                    className="grid-empty-btn grid-empty-btn--primary"
                    onClick={onNewSession}
                    type="button"
                  >
                    + 新建会话
                  </button>
                )}
                {onScanTmux && (
                  <button
                    className="grid-empty-btn grid-empty-btn--secondary"
                    onClick={onScanTmux}
                    type="button"
                  >
                    扫描 tmux
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : layoutMode === "group" ? (
        <div
          aria-label="会话分组看板"
          className="agent-group-board"
          data-grid-layout="group"
          data-testid="agent-grid"
        >
          {groupedBoardSessions.map((group) => {
            const collapsed = isSessionGroupCollapsed(
              sessionGroups,
              group.id,
              "group",
            );
            return (
              <section
                className="agent-group-board-section"
                data-grid-group={group.id}
                key={group.id}
              >
                <SessionGroupHeader
                  collapsed={collapsed}
                  count={group.sessions.length}
                  groupId={group.id}
                  groupIndex={sessionGroups.groups.findIndex(
                    (item) => item.id === group.id,
                  )}
                  name={group.name}
                  onDeleteGroup={onDeleteSessionGroup}
                  onRenameGroup={onRenameSessionGroup}
                  onToggleGroup={(groupId) =>
                    onToggleSessionGroup?.(groupId, "group")
                  }
                />
                {!collapsed &&
                  (group.sessions.length > 0 ? (
                    <div className="agent-group-board-cards">
                      {group.sessions.map(renderSessionCard)}
                    </div>
                  ) : (
                    <div className="agent-kanban-column-empty">
                      本筛选下暂无会话
                    </div>
                  ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div
          aria-label="会话状态看板"
          className={`agent-grid agent-kanban-board${shouldVirtualize ? " agent-grid--virtualized" : ""}`}
          data-grid-layout="status"
          data-testid="agent-grid"
          data-virtualized={shouldVirtualize ? "true" : "false"}
          onScroll={handleGridScroll}
          ref={gridRef}
          style={gridStyle}
        >
          {kanbanColumns.map((column) => {
            const groupedColumnSessions = groupingEnabled
              ? groupSessions(column.sessions, sessionGroups).filter(
                  (group) => group.sessions.length > 0,
                )
              : [];
            const virtualWindow = shouldVirtualize
              ? computeVirtualGridWindow({
                  itemCount: column.sessions.length,
                  containerWidth: gridMetrics.width / kanbanColumns.length,
                  viewportHeight: gridMetrics.height,
                  scrollTop: getAgentKanbanColumnScrollTop(
                    gridMetrics.scrollTop,
                    gridMetrics.columnContentTops[column.id],
                  ),
                })
              : null;
            const visibleColumnSessions = virtualWindow
              ? column.sessions.slice(
                  virtualWindow.startIndex,
                  virtualWindow.endIndex,
                )
              : column.sessions;

            return (
              <section
                aria-labelledby={`agent-kanban-column-${column.id}`}
                className={`agent-kanban-column agent-kanban-column--${column.id}`}
                data-kanban-column={column.id}
                key={column.id}
              >
                <header className="agent-kanban-column-header">
                  <h2 id={`agent-kanban-column-${column.id}`}>
                    {column.label}
                  </h2>
                  <span
                    aria-label={`${column.label} ${column.sessions.length} 个会话`}
                    className="agent-kanban-column-count"
                    data-kanban-count={column.sessions.length}
                  >
                    {column.sessions.length}
                  </span>
                </header>
                <div
                  className="agent-kanban-column-content"
                  data-kanban-column-content={column.id}
                >
                  {column.sessions.length === 0 ? (
                    <div className="agent-kanban-column-empty">
                      {column.emptyLabel}
                    </div>
                  ) : groupingEnabled ? (
                    groupedColumnSessions.map((group) => {
                      const collapsed = isSessionGroupCollapsed(
                        sessionGroups,
                        group.id,
                        column.id,
                      );
                      return (
                        <section className="agent-group-section" key={group.id}>
                          <SessionGroupHeader
                            collapsed={collapsed}
                            count={group.sessions.length}
                            groupId={group.id}
                            groupIndex={sessionGroups.groups.findIndex(
                              (item) => item.id === group.id,
                            )}
                            name={group.name}
                            onDeleteGroup={onDeleteSessionGroup}
                            onRenameGroup={onRenameSessionGroup}
                            onToggleGroup={(groupId) =>
                              onToggleSessionGroup?.(groupId, column.id)
                            }
                          />
                          {!collapsed && (
                            <div className="agent-kanban-card-list agent-group-grid">
                              {group.sessions.map(renderSessionCard)}
                            </div>
                          )}
                        </section>
                      );
                    })
                  ) : virtualWindow ? (
                    <div
                      className="agent-grid-virtual-spacer"
                      style={{ height: `${virtualWindow.totalHeight}px` }}
                    >
                      <div
                        className="agent-grid-virtual-window"
                        style={{
                          gap: `${AGENT_GRID_GAP}px`,
                          gridTemplateColumns: "minmax(0, 1fr)",
                          transform: `translateY(${virtualWindow.offsetY}px)`,
                        }}
                      >
                        {visibleColumnSessions.map(renderSessionCard)}
                      </div>
                    </div>
                  ) : (
                    <div className="agent-kanban-card-list">
                      {visibleColumnSessions.map(renderSessionCard)}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
