import { Button } from "@session/components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { buildWsUrl } from "@session/hooks/runtime";
import {
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
} from "@session/services/apiAdapt";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

const TERMINAL_THEME = {
  fontFamily: "Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  background: "#0a0a0a",
} as const;
let refreshingModule = false;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    refreshingModule = true;
  });

type TerminalDataPayload = { session_id: string; data: string };
type TerminalExitPayload = { session_id: string; message: string };

// xterm@5.x's Viewport schedules an internal setTimeout/rAF chain inside
// open() (Viewport -> _refresh -> _innerRefresh -> RenderService.dimensions).
// term.dispose() does not cancel that pending timer, so if a pane is
// unmounted (tab closed/switched quickly) before it fires, the callback
// runs against an already-disposed RenderService and throws
// "undefined is not an object (evaluating 'this._renderer.value.dimensions')"
// as an uncaught error outside our call stack — it cannot be caught with a
// normal try/catch around fit()/open(). Suppress just this known, benign
// error globally so it doesn't crash the app or show the dev error overlay.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (event.message?.includes("_renderer.value.dimensions")) {
      event.preventDefault();
    }
  });
}

interface TerminalPaneProps {
  active: boolean;
  panelOpen: boolean;
  /** Command auto-run once, right after the pty session for this pane starts. */
  command?: string;
}

export function TerminalPane({
  active,
  panelOpen,
  command,
}: TerminalPaneProps) {
  const { cwd } = useWorkspaceStore();
  const [connectionState, setConnectionState] = useState<
    "connecting" | "ready" | "offline"
  >("connecting");
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startRevision, setStartRevision] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const isAttachedRef = useRef(false);
  // Guards the one-time auto-run so it never re-fires on reconnect or re-activation.
  const hasRunCommandRef = useRef(false);

  const setSession = useCallback((sid: string | null) => {
    sessionIdRef.current = sid;
  }, []);

  // Create Terminal instance once per pane
  useEffect(() => {
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: TERMINAL_THEME.fontFamily,
      fontSize: TERMINAL_THEME.fontSize,
      scrollback: 5000,
      theme: { background: TERMINAL_THEME.background },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const disposeData = term.onData((data) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      void terminalWrite(sid, data).catch((err) => {
        term.writeln(`\r\n[write failed] ${String(err)}`);
      });
    });

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      disposeData.dispose();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      isAttachedRef.current = false;
    };
  }, []);

  // Attach xterm to DOM on first activation; re-fit on subsequent activations
  useEffect(() => {
    if (!active || !panelOpen) return;
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;
    if (!term || !fitAddon || !container) return;

    // Defer attachment until layout settles. React StrictMode disposes its
    // first effect pass immediately; opening that discarded instance starts
    // xterm's uncancellable viewport timer against a disposed renderer.
    const frame = requestAnimationFrame(() => {
      if (terminalRef.current !== term || !container.isConnected) return;
      if (!isAttachedRef.current) {
        term.open(container);
        isAttachedRef.current = true;
        // Only an attached, surviving renderer may create its native PTY.
        setStartRevision((value) => value + 1);
      }
      // Never refit a collapsed container or focus a pane after it was hidden.
      if (container.clientWidth > 1 && container.clientHeight > 1) {
        fitAddon.fit();
        term.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, panelOpen]);

  // Start backend session once attached
  const startSession = useCallback(async () => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    // Allow both desktop Tauri and web (HTTP API) mode —
    // service layer routes to invokeTauri or postJson accordingly.
    if (
      !term ||
      !fitAddon ||
      !isAttachedRef.current ||
      sessionIdRef.current ||
      isStartingRef.current
    )
      return;

    isStartingRef.current = true;
    setIsStarting(true);
    setStartError(null);
    try {
      const { session_id } = await terminalStart(
        cwd,
        Math.max(term.cols, 2),
        Math.max(term.rows, 2),
      );
      if (terminalRef.current !== term) {
        void terminalStop(session_id);
        return;
      }
      setSession(session_id);
      if (command && !hasRunCommandRef.current) {
        hasRunCommandRef.current = true;
        void terminalWrite(session_id, `${command}\r`);
      }
    } catch (err) {
      if (terminalRef.current !== term) return;
      setStartError(err instanceof Error ? err.message : String(err));
      terminalRef.current?.writeln(`\r\n[session start failed] ${String(err)}`);
    } finally {
      isStartingRef.current = false;
      if (terminalRef.current) {
        setIsStarting(false);
        if (terminalRef.current !== term)
          setStartRevision((value) => value + 1);
      }
    }
  }, [cwd, command, setSession]);

  useEffect(() => {
    if (!active || !panelOpen || startError) return;
    void startSession();
  }, [active, panelOpen, startSession, startRevision, startError]);

  // Shared handlers for terminal data/exit events, used by both
  // the Tauri event listener and the web WebSocket listener below.
  const handleTerminalData = useCallback((payload: TerminalDataPayload) => {
    if (payload.session_id !== sessionIdRef.current) return;
    terminalRef.current?.write(payload.data);
  }, []);

  const handleTerminalExit = useCallback(
    (payload: TerminalExitPayload) => {
      if (payload.session_id !== sessionIdRef.current) return;
      terminalRef.current?.writeln(`\r\n[${payload.message}]`);
      setSession(null);
    },
    [setSession],
  );

  // The pty lives in the web server on every platform — the desktop reaches
  // its own loopback instance, a phone reaches the paired desktop — so output
  // always arrives over the WebSocket rather than the Tauri event bus.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByCleanup = false;

    const connect = () => {
      ws = new WebSocket(buildWsUrl("/ws"));
      ws.onopen = () => {
        if (!closedByCleanup) setConnectionState("ready");
      };

      ws.onmessage = (messageEvent) => {
        try {
          const envelope = JSON.parse(messageEvent.data as string) as {
            event?: string;
            payload?: unknown;
          };

          if (envelope.event === "terminal:data" && envelope.payload) {
            handleTerminalData(envelope.payload as TerminalDataPayload);
          } else if (envelope.event === "terminal:exit" && envelope.payload) {
            handleTerminalExit(envelope.payload as TerminalExitPayload);
          }
        } catch (error) {
          console.warn(
            "[TerminalPane] Failed to parse websocket message:",
            error,
          );
        }
      };

      ws.onclose = () => {
        if (closedByCleanup) return;
        setConnectionState("offline");
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [handleTerminalData, handleTerminalExit]);

  // Resize — only when this pane is active and visible
  useEffect(() => {
    const fitAndResize = () => {
      if (!active || !panelOpen) return;
      const term = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const container = containerRef.current;
      if (!term || !fitAddon || !container || !isAttachedRef.current) return;
      if (container.clientWidth < 2 || container.clientHeight < 2) return;
      fitAddon.fit();
      const sid = sessionIdRef.current;
      if (sid) {
        void terminalResize(
          sid,
          Math.max(term.cols, 2),
          Math.max(term.rows, 2),
        );
      }
    };

    const observer = new ResizeObserver(fitAndResize);
    if (active && panelOpen && containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [active, panelOpen]);

  // Stop session on pane unmount
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid && !refreshingModule) void terminalStop(sid);
    };
  }, []);

  return (
    <div
      className="absolute inset-0"
      style={{ visibility: active ? "visible" : "hidden" }}
    >
      {startError ? (
        <div
          role="alert"
          className="absolute inset-x-2 top-2 z-10 rounded border border-destructive/40 bg-background p-2 text-xs text-destructive"
        >
          <p className="break-words">终端启动失败：{startError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={isStarting || !active || !panelOpen}
            onClick={() => void startSession()}
          >
            重试启动终端
          </Button>
        </div>
      ) : (
        (connectionState !== "ready" || isStarting) && (
          <div
            role={connectionState === "offline" ? "alert" : "status"}
            className="pointer-events-none absolute right-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded border border-border bg-background/95 px-2 py-1 text-xs text-muted-foreground"
          >
            {connectionState === "offline"
              ? "终端输出连接已断开，正在重连…"
              : isStarting
                ? "正在启动终端…"
                : "正在连接终端输出…"}
          </div>
        )
      )}
      <div
        ref={containerRef}
        role="application"
        aria-label="终端输入与输出"
        className="h-full w-full px-2 py-2"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  );
}
