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
}

interface GridMetrics {
  width: number;
  height: number;
  scrollTop: number;
}

const defaultGridMetrics: GridMetrics = {
  width: 0,
  height: 0,
  scrollTop: 0,
};

function readGridMetrics(element: HTMLDivElement): GridMetrics {
  return {
    width: element.clientWidth,
    height: element.clientHeight,
    scrollTop: element.scrollTop,
  };
}

function sameGridMetrics(a: GridMetrics, b: GridMetrics): boolean {
  return (
    a.width === b.width && a.height === b.height && a.scrollTop === b.scrollTop
  );
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
}: AgentGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [gridMetrics, setGridMetrics] =
    useState<GridMetrics>(defaultGridMetrics);
  const runningCount = sessions.filter(
    (session) => session.interactionState === "running",
  ).length;
  const shouldVirtualize =
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
  }, [sessions.length, shouldVirtualize, updateGridMetrics]);

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
      updateGridMetrics();
    });
  }, [shouldVirtualize, updateGridMetrics]);

  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) return null;

    return computeVirtualGridWindow({
      itemCount: sessions.length,
      containerWidth: gridMetrics.width,
      viewportHeight: gridMetrics.height,
      scrollTop: gridMetrics.scrollTop,
    });
  }, [
    gridMetrics.height,
    gridMetrics.scrollTop,
    gridMetrics.width,
    sessions.length,
    shouldVirtualize,
  ]);

  const visibleSessions =
    virtualWindow === null
      ? sessions
      : sessions.slice(virtualWindow.startIndex, virtualWindow.endIndex);
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
          {hiddenCount > 0 && (
            <button
              className="hidden-sessions-btn"
              onClick={onShowHidden}
              type="button"
            >
              已隐藏 ({hiddenCount})
            </button>
          )}
          {runningCount > 0 && (
            <span
              className="stat-item stat-running grid-status-chip"
              data-testid="grid-stat-running"
            >
              🟢 {runningCount} 运行中
            </span>
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
              <p className="grid-empty-hint">点击左侧面板启动或扫描 Agent</p>
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
      ) : (
        <div
          className={`agent-grid${shouldVirtualize ? " agent-grid--virtualized" : ""}`}
          data-testid="agent-grid"
          data-virtualized={shouldVirtualize ? "true" : "false"}
          onScroll={handleGridScroll}
          ref={gridRef}
          style={gridStyle}
        >
          {virtualWindow === null ? (
            visibleSessions.map(renderSessionCard)
          ) : (
            <div
              className="agent-grid-virtual-spacer"
              style={{ height: `${virtualWindow.totalHeight}px` }}
            >
              <div
                className="agent-grid-virtual-window"
                style={{
                  gap: `${AGENT_GRID_GAP}px`,
                  gridTemplateColumns: `repeat(${virtualWindow.columns}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualWindow.offsetY}px)`,
                }}
              >
                {visibleSessions.map(renderSessionCard)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
