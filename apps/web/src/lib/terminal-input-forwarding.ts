import { isTerminalProtocolResponsePayload } from "./terminal-input";

const TERMINAL_RECONNECT_BASE_DELAY_MS = 250;
const TERMINAL_RECONNECT_MAX_DELAY_MS = 5_000;
const BRACKETED_PASTE_ENABLE_SEQUENCE = "\u001b[?2004h";

export function getTerminalInputModeRestoreSequence({
  restoreBracketedPaste,
}: {
  restoreBracketedPaste: boolean;
}): string {
  return restoreBracketedPaste ? BRACKETED_PASTE_ENABLE_SEQUENCE : "";
}

export function computeTerminalReconnectDelay(attempt: number): number {
  const boundedAttempt = Math.min(
    20,
    Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0)),
  );

  return Math.min(
    TERMINAL_RECONNECT_MAX_DELAY_MS,
    TERMINAL_RECONNECT_BASE_DELAY_MS * 2 ** boundedAttempt,
  );
}

export function shouldAttemptTerminalInputForward({
  inputEnabled,
  terminalInputReady = true,
  sanitizedPayload,
  socketOpen,
}: {
  inputEnabled: boolean;
  terminalInputReady?: boolean;
  sanitizedPayload: string;
  socketOpen: boolean;
}): boolean {
  return (
    sanitizedPayload.length > 0 &&
    socketOpen &&
    ((inputEnabled && terminalInputReady) ||
      isTerminalProtocolResponsePayload(sanitizedPayload))
  );
}
