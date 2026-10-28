import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { resizeSession } from "../../api/boardApi";
import { buildWebSocketUrl } from "../../core/transport";
import { buildTerminalReplayQuery, parseTerminalFrame } from "../../lib/terminalFrames";
import { colors } from "../../theme";
import { buildTerminalHtml } from "./terminalHtml";

// Mobile terminals request a bounded replay so the screen is not flooded.
const MOBILE_TERMINAL_REPLAY_BYTES = 256 * 1024;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 8000;

type BridgeMessage =
  | { type: "input"; data: string }
  | { type: "resize"; data: { cols: number; rows: number } }
  | { type: "ready"; data: null }
  | { type: "error"; data: string };

interface TerminalViewProps {
  agentSessionId: string;
  fontSize?: number;
  interactive?: boolean;
  mobileTouchMode?: boolean;
  tmuxMouseReporting?: boolean;
  onFontSizeChange?: (fontSize: number) => void;
  scrollToBottomRequest?: number;
}

export function TerminalView({
  agentSessionId,
  fontSize = 14,
  interactive = true,
  mobileTouchMode = true,
  tmuxMouseReporting = false,
  onFontSizeChange,
  scrollToBottomRequest,
}: TerminalViewProps) {
  const webViewRef = useRef<WebView>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);
  const replayCompleteRef = useRef(false);
  const [phase, setPhase] = useState<"connecting" | "connected" | "reconnecting">(
    "connecting",
  );

  const writeToTerminal = useCallback((data: string) => {
    webViewRef.current?.injectJavaScript(
      `if (window.__term_output) { window.__term_output(${JSON.stringify(data)}); } true;`,
    );
  }, []);

  const openSocket = useCallback(
    (agentId: string) => {
      if (disposedRef.current) return;
      const replay = mobileTouchMode ? MOBILE_TERMINAL_REPLAY_BYTES : undefined;
      const query = buildTerminalReplayQuery(replay);
      const wsUrl = buildWebSocketUrl(
        `/api/agent-sessions/${agentId}/terminal-stream${query ? `?${query}` : ""}`,
      );

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        setPhase("reconnecting");
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposedRef.current) return;
        setPhase("connected");
      };

      socket.onmessage = (event: { data: unknown }) => {
        let text = "";
        if (typeof event.data === "string") text = event.data;
        else if (event.data instanceof Blob) {
          void event.data.text().then((t) => {
            if (!disposedRef.current) handleFrame(t);
          });
          return;
        } else if (ArrayBuffer.isView(event.data)) {
          text = new TextDecoder().decode(event.data);
        } else return;

        handleFrame(text);
      };

      const handleFrame = (payload: string) => {
        const frame = parseTerminalFrame(payload);
        if (frame.kind === "output") {
          writeToTerminal(frame.data);
        } else if (frame.kind === "replay") {
          writeToTerminal(frame.data);
        } else if (frame.kind === "replay-complete") {
          replayCompleteRef.current = true;
          setPhase("connected");
        }
      };

      socket.onclose = () => {
        if (disposedRef.current) return;
        setPhase("reconnecting");
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        const delay = WS_RECONNECT_BASE_MS;
        reconnectTimer.current = setTimeout(() => openSocket(agentId), delay);
      };

      socket.onerror = () => {
        // onclose will follow; nothing extra here.
      };
    },
    [mobileTouchMode, writeToTerminal],
  );

  useEffect(() => {
    disposedRef.current = false;
    replayCompleteRef.current = false;
    openSocket(agentSessionId);
    return () => {
      disposedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
    };
  }, [agentSessionId, openSocket]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      if (message.type === "input" && typeof message.data === "string") {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(message.data);
        }
      } else if (message.type === "resize" && message.data?.cols && message.data?.rows) {
        void resizeSession(agentSessionId, message.data.cols, message.data.rows);
      } else if (message.type === "error") {
        setPhase("reconnecting");
      }
    },
    [agentSessionId],
  );

  // Push font size changes into the WebView.
  useEffect(() => {
    if (!webViewRef.current || !fontSize) return;
    webViewRef.current.injectJavaScript(
      `if (window.__term_output && document.querySelector('.xterm')) { try { var t = window.__term; } catch(e) {} } true;`,
    );
  }, [fontSize]);

  return (
    <View style={styles.root}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: buildTerminalHtml() }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        style={{ backgroundColor: colors.terminalBg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.terminalBg },
});
