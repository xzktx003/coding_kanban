export const CODEX_WINDOW_THREADS_KEY = "kanban.codex.window-threads.v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateCodexWindowIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2)
    return undefined;
  const windowIds = value as unknown[];
  if (
    !windowIds.every(
      (id) => typeof id === "string" && UUID.test(id as string),
    ) ||
    new Set(windowIds).size !== windowIds.length
  )
    return undefined;
  return windowIds as string[];
}

function validWindowIds(windowIds: readonly string[]): boolean {
  return validateCodexWindowIds(windowIds) !== undefined;
}

function validThreadId(threadId: unknown): threadId is string {
  return typeof threadId === "string" && UUID.test(threadId);
}

export function readCodexWindowThreads(
  storage: Pick<Storage, "getItem">,
  windowIds: readonly string[],
): Map<string, string> {
  if (!validWindowIds(windowIds)) return new Map();
  try {
    const raw = storage.getItem(CODEX_WINDOW_THREADS_KEY);
    if (!raw || raw.length > 2048) return new Map();
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as { version?: unknown }).version !== 1 ||
      !("windows" in value) ||
      !value.windows ||
      typeof value.windows !== "object" ||
      Array.isArray(value.windows)
    )
      return new Map();
    const persisted = value.windows as Record<string, unknown>;
    const result = new Map<string, string>();
    for (const windowId of windowIds) {
      if (validThreadId(persisted[windowId]))
        result.set(windowId, persisted[windowId]);
    }
    return result;
  } catch {
    return new Map();
  }
}

export function persistCodexWindowThread(
  storage: Pick<Storage, "getItem" | "setItem">,
  windowIds: readonly string[],
  windowId: string,
  threadId: string,
): boolean {
  if (
    !validWindowIds(windowIds) ||
    !windowIds.includes(windowId) ||
    !validThreadId(threadId)
  )
    return false;
  try {
    const threads = readCodexWindowThreads(storage, windowIds);
    threads.set(windowId, threadId);
    storage.setItem(
      CODEX_WINDOW_THREADS_KEY,
      JSON.stringify({ version: 1, windows: Object.fromEntries(threads) }),
    );
    return true;
  } catch {
    return false;
  }
}

export function shouldRestoreCodexWindowThread(input: {
  windowId: string;
  windowIds: readonly string[];
  savedThreadId: string | undefined;
  currentThreadId: string | null;
  hasComposer: boolean;
  composerEmpty: boolean;
  userInteracted?: boolean;
}): boolean {
  return (
    validWindowIds(input.windowIds) &&
    input.windowIds.includes(input.windowId) &&
    validThreadId(input.savedThreadId) &&
    input.currentThreadId === null &&
    input.hasComposer &&
    input.composerEmpty &&
    input.userInteracted !== true
  );
}
