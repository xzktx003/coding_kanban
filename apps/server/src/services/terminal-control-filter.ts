const TERMINAL_REPLAY_PATTERNS = [
  /\u001b\[\?[\d;]*[hl]/g,
  /\u001b[=>]/g,
  /\u001b\[(?:[?>])?[\d;]*c/g,
  /\u001b\[\??[\d;]*n/g,
  /\u001b\[\??[\d;]*R/g,
  /\u001b\[[\d;]*t/g,
  /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,
  /\u001bP[\s\S]*?\u001b\\/g,
];

const TERMINAL_INPUT_PATTERNS = [
  /\u001b\[>[\d;]*c/g,
  /\u001b\](?:10|11);rgb:(?:[0-9a-fA-F]{2}\/[0-9a-fA-F]{2}\/[0-9a-fA-F]{2}|[0-9a-fA-F]{4}\/[0-9a-fA-F]{4}\/[0-9a-fA-F]{4})(?:\u0007|\u001b\\)/g,
  /\u001b\]4;\d+;rgb:(?:[0-9a-fA-F]{2}\/[0-9a-fA-F]{2}\/[0-9a-fA-F]{2}|[0-9a-fA-F]{4}\/[0-9a-fA-F]{4}\/[0-9a-fA-F]{4})(?:\u0007|\u001b\\)/g,
];

const TERMINAL_MOUSE_PAYLOAD_PATTERN =
  /^(?:(?:\u001b\[<\d+;\d+;\d+[mM])|(?:\u001b\[\d+;\d+;\d+M)|(?:\u001b\[M[\s\S]{3}))+$/;
const TERMINAL_FOCUS_PAYLOAD_PATTERN = /^(?:\u001b\[[IO])+$/;
const TERMINAL_PROTOCOL_QUERY_PATTERN = /\u001b\[\??(0?c|[56]n)/g;
const TERMINAL_PROTOCOL_RESPONSE_SEQUENCE_PATTERN =
  /\u001b\[(?:\?[\d;]*|>[\d;]*|[\d;]*)c|\u001b\[\??[\d;]+n|\u001b\[\d+;\d+R/g;
const TERMINAL_PROTOCOL_RESPONSE_PAYLOAD_PATTERN =
  /^(?:\u001b\[(?:\?[\d;]*|>[\d;]*|[\d;]*)c|\u001b\[\??[\d;]+n|\u001b\[\d+;\d+R)+$/;

function stripPatterns(text: string, patterns: RegExp[]): string {
  return patterns.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, ""),
    text,
  );
}

export type TerminalProtocolResponseKind =
  | "device-attributes"
  | "status"
  | "cursor-position";

export interface TerminalProtocolResponse {
  kind: TerminalProtocolResponseKind;
  payload: string;
}

export function sanitizeReplayForTerminal(data: string): string {
  return stripPatterns(data, TERMINAL_REPLAY_PATTERNS);
}

// Live stdin MUST pass DA/DSR/OSC/DCS replies through to the PTY — xterm.js
// auto-answers capability queries from TUIs like Copilot CLI, and stripping
// those replies here makes the TUI wait forever and stop accepting input.
// The live-input exceptions are Secondary DA (`CSI > c`) and noisy OSC
// 10/11/4 rgb color replies. Shell prompts can emit Secondary DA while still
// in line-editing mode, which causes the raw terminal version reply
// (`0;276;0c`) to be echoed back into the prompt. Some terminals also reply to
// OSC color queries with rgb payloads that should not be echoed into stdin.
export function stripTerminalResponsePayload(payload: string): string {
  return stripPatterns(payload, TERMINAL_INPUT_PATTERNS);
}

export function isTerminalProtocolResponsePayload(payload: string): boolean {
  return TERMINAL_PROTOCOL_RESPONSE_PAYLOAD_PATTERN.test(payload);
}

export function getTerminalProtocolQueryResponseKinds(
  payload: string,
): TerminalProtocolResponseKind[] {
  return Array.from(payload.matchAll(TERMINAL_PROTOCOL_QUERY_PATTERN), (match) => {
    switch (match[1]) {
      case "5n":
        return "status";
      case "6n":
        return "cursor-position";
      default:
        return "device-attributes";
    }
  });
}

export function getTerminalProtocolResponses(
  payload: string,
): TerminalProtocolResponse[] {
  return Array.from(
    payload.matchAll(TERMINAL_PROTOCOL_RESPONSE_SEQUENCE_PATTERN),
    (match) => {
      const response = match[0]!;
      return {
        kind: response.endsWith("c")
          ? "device-attributes"
          : response.endsWith("n")
            ? "status"
            : "cursor-position",
        payload: response,
      };
    },
  );
}

export function isTerminalMousePayload(payload: string): boolean {
  return TERMINAL_MOUSE_PAYLOAD_PATTERN.test(payload);
}

export function isTerminalFocusPayload(payload: string): boolean {
  return TERMINAL_FOCUS_PAYLOAD_PATTERN.test(payload);
}

export function isTerminalPtyControlPayload(payload: string): boolean {
  return (
    TERMINAL_MOUSE_PAYLOAD_PATTERN.test(payload) ||
    TERMINAL_FOCUS_PAYLOAD_PATTERN.test(payload)
  );
}
