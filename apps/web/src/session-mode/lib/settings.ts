import {
  normalizeSessionNames,
  useSessionNameStore,
} from "../stores/useSessionNameStore";
/**
 * Legacy server settings retain backend-owned configuration and session display names.
 * Shared project/tab membership uses operation APIs; device navigation/preferences
 * persist in browser stores and must never be written back as a workspace snapshot.
 */

import {
  getJsonWithOptions,
  postNoContentWithOptions,
} from "@session/services/apiAdapt/shared";
import { fetchRemoteSettings } from "@session/services/apiAdapt/settings";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkspaceData = {
  projects: string[];
  historyProjects: string[];
  selectedAgent: string;
  cwd: string | undefined;
  projectSort: string;
  instructionType: string;
};

interface SettingsFile {
  version?: number;
  workspace?: Partial<WorkspaceData>;
  /** Keys owned by the backend (e.g. `remote`) are carried through untouched. */
  [key: string]: unknown;
}

// ── File I/O ─────────────────────────────────────────────────────────────────

async function readSettingsFile(signal?: AbortSignal): Promise<SettingsFile> {
  return getJsonWithOptions<SettingsFile>("/api/settings", {
    suppressToast: true,
    signal,
  });
}

// ── Hydration ─────────────────────────────────────────────────────────────────

function applySettings(
  data: SettingsFile,
  revisions: Record<string, number>,
): void {
  const remote = normalizeSessionNames(data.sessionNames);
  useSessionNameStore.setState((s) => {
    let names = s.names;
    for (const [key, value] of Object.entries(remote)) {
      if (
        (s.editRevisions[key] ?? 0) !== (revisions[key] ?? 0) ||
        names[key] === value
      )
        continue;
      if (names === s.names) names = { ...names };
      names[key] = value;
    }
    return names === s.names ? s : { names };
  });
  // Workspace membership is now managed by /api/session/projects.
  // cwd, history, selected Agent and layout belong to this browser; remote settings
  // must never hydrate them over a restored local workspace.
}

export async function loadSettings(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const revisions = useSessionNameStore.getState().editRevisions;
  const data = await readSettingsFile(signal);
  signal?.throwIfAborted();
  applySettings(data, revisions);
}

/** Why the last remote load produced no projects, for the phone to show. */
let lastRemoteError: string | null = null;
export const remoteSettingsError = (): string | null => lastRemoteError;

/**
 * Load settings from the connected desktop via its API. Used on iOS.
 *
 * Returns false when the desktop answered with nothing usable, so the caller
 * can fall back to reading the file over the remote filesystem API instead.
 */
export async function loadRemoteSettings(
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const revisions = useSessionNameStore.getState().editRevisions;
  try {
    const data = (await fetchRemoteSettings({ signal })) as SettingsFile;
    signal?.throwIfAborted();
    lastRemoteError = data.workspace
      ? null
      : "The desktop returned no workspace settings.";
    if (!data.workspace) return false;
    applySettings(data, revisions);
    return true;
  } catch (err) {
    signal?.throwIfAborted();
    lastRemoteError = String(err);
    console.error("[settings] loadRemoteSettings failed:", err);
    return false;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const pending = writeQueue.catch(() => {}).then(work);
  writeQueue = pending;
  return pending;
}

/** Persist a display name alongside workspace settings; never edit native agent history. */
export function saveSessionName(key: string, name: string): Promise<void> {
  return enqueueWrite(async () => {
    const existing = await getJsonWithOptions<SettingsFile>("/api/settings", {
      suppressToast: true,
    });
    const sessionNames = {
      ...normalizeSessionNames(existing.sessionNames),
      [key]: name,
    };
    await postNoContentWithOptions("/api/settings", {
      ...existing,
      sessionNames,
    });
  });
}

/** Workspace/Agent stores persist locally; shared collections use operation queues. */
export function initSettingsSync(): () => void {
  return () => {};
}
