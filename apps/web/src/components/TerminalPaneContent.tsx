import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { LazyTerminalView } from "./LazyTerminalView";
import { TerminalPreview } from "./TerminalPreview";
import {
  resolveRecentTerminalSessionIds,
  shouldMountTerminalPane,
} from "../lib/terminal-pane-render-policy";
import {
  focusTerminalPaneLoadScheduler,
  type TerminalPaneLoadPermit,
  type TerminalPaneLoadRequest,
} from "../lib/terminal-pane-load-scheduler";

interface TerminalPaneContentProps {
  active: boolean;
  cacheCapacity: number;
  fontSize?: number;
  groupArrangement: boolean;
  mobileTouchMode: boolean;
  onFontSizeChange?: (fontSize: number) => void;
  session: AgentSessionRecord;
  sessions: AgentSessionRecord[];
}

const ACTIVE_TERMINAL_LOAD_PRIORITY = 100;
const MONITOR_TERMINAL_LOAD_PRIORITY = 0;
const TERMINAL_LOAD_PERMIT_SAFETY_MS = 12_000;

export function TerminalPaneContent({
  active,
  cacheCapacity,
  fontSize,
  groupArrangement,
  mobileTouchMode,
  onFontSizeChange,
  session,
  sessions,
}: TerminalPaneContentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(!groupArrangement && active);
  const [recentSessionIds, setRecentSessionIds] = useState<string[]>([
    session.id,
  ]);
  const [permittedSessionId, setPermittedSessionId] = useState<string | null>(
    cacheCapacity > 1 ? session.id : null,
  );
  const [readySessionIds, setReadySessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const loadPermitRef = useRef<TerminalPaneLoadPermit | null>(null);
  const loadRequestRef = useRef<TerminalPaneLoadRequest | null>(null);
  const loadPermitSafetyTimerRef = useRef<number | null>(null);

  const mountedSessionIds = resolveRecentTerminalSessionIds(
    session.id,
    recentSessionIds,
    groupArrangement ? 1 : cacheCapacity,
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((item) => [item.id, item])),
    [sessions],
  );
  const mountCurrentTerminal = shouldMountTerminalPane({
    active,
    groupArrangement,
    visible,
  });
  const serializeInitialLoad = cacheCapacity <= 1;
  const loadAllowed =
    !serializeInitialLoad || permittedSessionId === session.id;

  const releaseLoadPermit = () => {
    if (loadPermitSafetyTimerRef.current !== null) {
      window.clearTimeout(loadPermitSafetyTimerRef.current);
      loadPermitSafetyTimerRef.current = null;
    }
    loadPermitRef.current?.release();
    loadPermitRef.current = null;
  };

  const markTerminalReady = (sessionId: string) => {
    setReadySessionIds((current) => {
      if (current.has(sessionId)) {
        return current;
      }

      const next = new Set(current);
      next.add(sessionId);
      return next;
    });

    if (sessionId === session.id) {
      releaseLoadPermit();
    }
  };

  useEffect(() => {
    setRecentSessionIds((current) => {
      const next = resolveRecentTerminalSessionIds(
        session.id,
        current,
        groupArrangement ? 1 : cacheCapacity,
      );
      return next.length === current.length &&
        next.every((sessionId, index) => sessionId === current[index])
        ? current
        : next;
    });
  }, [cacheCapacity, groupArrangement, session.id]);

  useEffect(() => {
    const mounted = new Set(mountedSessionIds);
    setReadySessionIds((current) => {
      const next = new Set(
        Array.from(current).filter((sessionId) => mounted.has(sessionId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [mountedSessionIds.join("\u0000")]);

  useEffect(() => {
    if (!groupArrangement) {
      setVisible(true);
      return;
    }

    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const root = target.closest(".focus-terminal-layout--group");
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      {
        root,
        rootMargin: "25% 0px",
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [groupArrangement, session.id]);

  useEffect(() => {
    if (!mountCurrentTerminal) {
      setPermittedSessionId(null);
      return;
    }

    if (!serializeInitialLoad) {
      setPermittedSessionId(session.id);
      return;
    }

    setPermittedSessionId(null);
    const request = focusTerminalPaneLoadScheduler.request(
      active ? ACTIVE_TERMINAL_LOAD_PRIORITY : MONITOR_TERMINAL_LOAD_PRIORITY,
      (permit) => {
        loadPermitRef.current = permit;
        setPermittedSessionId(session.id);
        loadPermitSafetyTimerRef.current = window.setTimeout(() => {
          loadPermitSafetyTimerRef.current = null;
          permit.release();
          if (loadPermitRef.current === permit) {
            loadPermitRef.current = null;
          }
        }, TERMINAL_LOAD_PERMIT_SAFETY_MS);
      },
    );
    loadRequestRef.current = request;

    return () => {
      if (loadRequestRef.current === request) {
        loadRequestRef.current = null;
      }
      request.cancel();
      releaseLoadPermit();
    };
  }, [mountCurrentTerminal, serializeInitialLoad, session.id]);

  useEffect(() => {
    loadRequestRef.current?.updatePriority(
      active ? ACTIVE_TERMINAL_LOAD_PRIORITY : MONITOR_TERMINAL_LOAD_PRIORITY,
    );
  }, [active]);

  const loadingPreview = (loading: boolean) => (
    <div
      data-terminal-render-mode={loading ? "loading" : "preview"}
      className="terminal-pane-stack terminal-pane-loading-preview"
    >
      <TerminalPreview session={session} />
      {loading && (
        <div className="terminal-pane-loading-status" role="status">
          正在加载完整终端…
        </div>
      )}
    </div>
  );

  return (
    <div className="focus-terminal-pane-terminal" ref={containerRef}>
      {mountCurrentTerminal && loadAllowed ? (
        <div data-terminal-render-mode="live" className="terminal-pane-stack">
          {mountedSessionIds.flatMap((sessionId) => {
            const mountedSession = sessionById.get(sessionId);
            if (!mountedSession) {
              return [];
            }

            const current = mountedSession.id === session.id;
            return [
              <div
                aria-hidden={current ? undefined : "true"}
                className="terminal-pane-session-layer"
                data-terminal-cache-active={current ? "true" : "false"}
                data-terminal-ready={
                  readySessionIds.has(mountedSession.id) ? "true" : "false"
                }
                hidden={!current}
                key={mountedSession.id}
              >
                <Suspense
                  fallback={<TerminalPreview session={mountedSession} />}
                >
                  <LazyTerminalView
                    agentSessionId={mountedSession.id}
                    fontSize={fontSize}
                    interactive={true}
                    inputEnabled={active && current}
                    mobileTouchMode={mobileTouchMode}
                    onFontSizeChange={onFontSizeChange}
                    onReady={() => markTerminalReady(mountedSession.id)}
                    preferLocalMouseSelection={
                      mountedSession.agentKind.toLowerCase() === "opencode"
                    }
                    restoreBracketedPasteMode={
                      mountedSession.agentKind.toLowerCase() === "opencode"
                    }
                    wheelPassthrough={groupArrangement}
                  />
                </Suspense>
                {!readySessionIds.has(mountedSession.id) && (
                  <div className="terminal-pane-loading-overlay">
                    <TerminalPreview session={mountedSession} />
                    <div className="terminal-pane-loading-status" role="status">
                      正在加载完整终端…
                    </div>
                  </div>
                )}
              </div>,
            ];
          })}
        </div>
      ) : (
        loadingPreview(mountCurrentTerminal)
      )}
    </div>
  );
}
