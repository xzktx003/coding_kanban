const SAFARI_TEXT_MATCH_WINDOW_MS = 100;
const MAX_TRACKED_TEXT_LENGTH = 4096;

export interface SafariTextInputRecoveryState {
  pendingText: string;
  recordedAt: number;
}

interface SafariBrowserIdentity {
  userAgent: string;
  vendor: string;
}

export function createSafariTextInputRecoveryState(): SafariTextInputRecoveryState {
  return {
    pendingText: "",
    recordedAt: 0,
  };
}

export function isSafariTerminalInputRecoveryRequired({
  userAgent,
  vendor,
}: SafariBrowserIdentity): boolean {
  return (
    vendor.includes("Apple") &&
    /Safari\//.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android)/.test(userAgent)
  );
}

function isPlainTerminalText(data: string): boolean {
  return (
    data.length > 0 &&
    [...data].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
  );
}

function clearRecoveryState(state: SafariTextInputRecoveryState): void {
  state.pendingText = "";
  state.recordedAt = 0;
}

export function recordTerminalTextForSafariRecovery(
  state: SafariTextInputRecoveryState,
  data: string,
  now: number,
): void {
  if (!isPlainTerminalText(data)) {
    clearRecoveryState(state);
    return;
  }

  if (
    state.pendingText &&
    now - state.recordedAt <= SAFARI_TEXT_MATCH_WINDOW_MS
  ) {
    state.pendingText = `${state.pendingText}${data}`.slice(
      -MAX_TRACKED_TEXT_LENGTH,
    );
  } else {
    state.pendingText = data.slice(-MAX_TRACKED_TEXT_LENGTH);
  }
  state.recordedAt = now;
}

export function recoverSafariNativeTextInput(
  state: SafariTextInputRecoveryState,
  nativeText: string,
  now: number,
): string {
  if (!nativeText) {
    return "";
  }

  if (
    !state.pendingText ||
    now - state.recordedAt > SAFARI_TEXT_MATCH_WINDOW_MS
  ) {
    clearRecoveryState(state);
    return nativeText;
  }

  let matchedLength = 0;
  const maxMatchLength = Math.min(state.pendingText.length, nativeText.length);
  while (
    matchedLength < maxMatchLength &&
    state.pendingText[matchedLength] === nativeText[matchedLength]
  ) {
    matchedLength += 1;
  }

  if (matchedLength === 0) {
    return nativeText;
  }

  state.pendingText = state.pendingText.slice(matchedLength);
  if (!state.pendingText) {
    state.recordedAt = 0;
  }

  return nativeText.slice(matchedLength);
}
