// Pure parser for the terminal WebSocket frame protocol (mirrors the web
// TerminalView.handleTerminalFrame). Exported as a pure module for tests.

export type TerminalFrame =
  | { kind: "output"; data: string }
  | { kind: "replay"; data: string }
  | { kind: "replay-complete" }
  | { kind: "unknown"; data: string };

const CONTROL_MARKER = "__agentOrchestrator";

export function parseTerminalFrame(payload: string): TerminalFrame {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (parsed[CONTROL_MARKER] !== "terminal-control") {
      return { kind: "output", data: payload };
    }
    if (parsed.event === "replay" && typeof parsed.data === "string") {
      return { kind: "replay", data: parsed.data };
    }
    if (parsed.event === "replay-complete") {
      return { kind: "replay-complete" };
    }
    return { kind: "unknown", data: payload };
  } catch {
    // Not JSON -> raw terminal output.
    return { kind: "output", data: payload };
  }
}

export function buildTerminalReplayQuery(replayBytes?: number): string {
  if (!replayBytes) return "";
  return `replayBytes=${replayBytes}`;
}
