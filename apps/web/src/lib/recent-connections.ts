/**
 * Recent tmux connections persistence.
 * Stores the last N quick-connect configurations in localStorage
 * so users can quickly re-attach to frequently used tmux sessions.
 */

const STORAGE_KEY = "quick-tmux-recent-connections";
const MAX_RECENT = 8;

export interface RecentTmuxConnection {
  hostName: string;
  hostId: string;
  sessionName: string;
  workingDirectory: string;
  connectedAt: string;
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

export function loadRecentConnections(): RecentTmuxConnection[] {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentTmuxConnection =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).hostName === "string" &&
        typeof (item as Record<string, unknown>).sessionName === "string",
    );
  } catch {
    return [];
  }
}

export function saveRecentConnection(connection: {
  hostName: string;
  hostId: string;
  sessionName: string;
  workingDirectory: string;
}): void {
  const recent = loadRecentConnections();
  const entry: RecentTmuxConnection = {
    ...connection,
    connectedAt: new Date().toISOString(),
  };
  // Remove duplicate (same host + session)
  const filtered = recent.filter(
    (r) => !(r.hostId === entry.hostId && r.sessionName === entry.sessionName),
  );
  // Add to front, cap at MAX_RECENT
  const updated = [entry, ...filtered].slice(0, MAX_RECENT);
  safeSetItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearRecentConnections(): void {
  safeSetItem(STORAGE_KEY, "[]");
}
