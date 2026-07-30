export const VSCODE_IFRAME_CACHE_MODE_STORAGE_KEY = "vscode-iframe-cache-mode";
export const MAX_CACHED_VSCODE_IFRAMES = 3;

export type VsCodeIframeCacheMode = "memory-saving" | "preserve-state";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function touchVsCodeCacheSessionIds(
  current: string[],
  sessionId: string,
  maxEntries: number,
): string[] {
  if (current.includes(sessionId)) {
    return current;
  }

  return [...current, sessionId].slice(-maxEntries);
}

export function parseVsCodeIframeCacheMode(
  value: string | null,
): VsCodeIframeCacheMode {
  return value === "preserve-state" ? "preserve-state" : "memory-saving";
}

export function formatVsCodeIframeCacheMode(
  mode: VsCodeIframeCacheMode,
): string {
  return mode;
}

export function loadVsCodeIframeCacheMode(
  storage: StorageLike | undefined = globalThis.localStorage,
): VsCodeIframeCacheMode {
  try {
    return parseVsCodeIframeCacheMode(
      storage?.getItem(VSCODE_IFRAME_CACHE_MODE_STORAGE_KEY) ?? null,
    );
  } catch {
    return "memory-saving";
  }
}

export function saveVsCodeIframeCacheMode(
  mode: VsCodeIframeCacheMode,
  storage: StorageLike | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(
      VSCODE_IFRAME_CACHE_MODE_STORAGE_KEY,
      formatVsCodeIframeCacheMode(mode),
    );
  } catch {
    // ignore storage failures
  }
}

export function toggleVsCodeIframeCacheMode(
  current: VsCodeIframeCacheMode,
): VsCodeIframeCacheMode {
  return current === "memory-saving" ? "preserve-state" : "memory-saving";
}

export function resolveLightweightTerminalPreviewForVsCodeCacheMode(
  mode: VsCodeIframeCacheMode,
): boolean {
  return mode === "memory-saving";
}

export function resolveRenderedVsCodeSessionIds({
  activeSessionId,
  cachedSessionIds,
  maxCachedIframes,
  mode,
}: {
  activeSessionId: string | null;
  cachedSessionIds: string[];
  maxCachedIframes: number;
  mode: VsCodeIframeCacheMode;
}): string[] {
  if (mode === "memory-saving") {
    return activeSessionId ? [activeSessionId] : [];
  }

  const next = [...cachedSessionIds];
  if (activeSessionId && !next.includes(activeSessionId)) {
    next.push(activeSessionId);
  }

  return next.slice(-maxCachedIframes);
}

export function releaseVsCodeCacheSessionIds(
  activeSessionId: string | null,
): string[] {
  return activeSessionId ? [activeSessionId] : [];
}
