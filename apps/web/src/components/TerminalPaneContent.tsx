import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { LazyTerminalView } from "./LazyTerminalView";
import { TerminalPreview } from "./TerminalPreview";
import {
  resolveRecentTerminalSessionIds,
  shouldMountTerminalPane,
} from "../lib/terminal-pane-render-policy";

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

  return (
    <div className="focus-terminal-pane-terminal" ref={containerRef}>
      {mountCurrentTerminal ? (
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
                    preferLocalMouseSelection={
                      mountedSession.agentKind.toLowerCase() === "opencode"
                    }
                    wheelPassthrough={groupArrangement}
                  />
                </Suspense>
              </div>,
            ];
          })}
        </div>
      ) : (
        <div
          data-terminal-render-mode="preview"
          className="terminal-pane-stack"
        >
          <TerminalPreview session={session} />
        </div>
      )}
    </div>
  );
}
